import argparse
import collections
import json
import socket
import struct
import sys
import threading
import math
import time
from pathlib import Path
from typing import Any

from elftools.elf.elffile import ELFFile
from elftools.dwarf.dwarf_expr import DWARFExprParser
from elftools.dwarf.locationlists import LocationExpr


class VariableNode:
    def __init__(self, name: str, addr: int, v_type: str, size: int, type_name: str, enum_values: dict[int, str] | None = None):
        self.name = name
        self.addr = addr
        self.type = v_type
        self.size = size
        self.type_name = type_name
        self.enum_values = enum_values or {}
        self.children: dict[str, "VariableNode"] = {}

    def to_summary(self, path: str) -> dict[str, Any]:
        return {
            "name": self.name,
            "path": path,
            "address": hex(self.addr),
            "type": self.type,
            "typeName": self.type_name,
            "size": self.size,
            "hasChildren": bool(self.children),
            "children": list(self.children.keys()),
        }


class TclRpcClient:
    def __init__(self, host: str = "127.0.0.1", port: int = 50001):
        self.host = host
        self.port = port
        self.sock: socket.socket | None = None
        self.lock = threading.Lock()
        self._connect()

    def _connect(self) -> None:
        try:
            if self.sock:
                self.sock.close()
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            self.sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
            self.sock.settimeout(0.1)
            self.sock.connect((self.host, self.port))
        except Exception:
            self.sock = None

    def _send_rpc_unlocked(self, cmd: str) -> str:
        """底层 RPC 发送方法，调用者需自行持有 self.lock"""
        if not self.sock:
            self._connect()
        if not self.sock:
            return ""
        try:
            self.sock.sendall(cmd.encode("ascii") + b"\x1a")
            chunks = []
            start_time = time.monotonic()
            while True:
                if time.monotonic() - start_time > 5.0:
                    raise ConnectionError("OpenOCD response timeout (5s)")
                chunk = self.sock.recv(16384)
                if not chunk:
                    break
                chunks.append(chunk)
                if b"\x1a" in chunk:
                    break
            return b"".join(chunks).decode("ascii", errors="ignore").strip("\x1a")
        except ConnectionError:
            self._connect()
            return ""
        except Exception:
            self._connect()
            return ""

    def _send_rpc(self, cmd: str) -> str:
        with self.lock:
            return self._send_rpc_unlocked(cmd)

    def is_connected(self) -> bool:
        """持锁检查 socket 连通性，并发一个轻量 RPC 验证 OpenOCD 可达"""
        with self.lock:
            if not self.sock:
                return False
            # 发送轻量 RPC 验证连通性，避免 TOCTOU 竞态
            result = self._send_rpc_unlocked("echo ping")
            return bool(result)

    def get_target_state(self) -> str:
        """查询目标状态，返回 'halted' 或 'running'"""
        with self.lock:
            raw = self._send_rpc_unlocked("capture \"targets\"")
            if "halted" in raw.lower():
                return "halted"
            return "running"

    def halt(self) -> None:
        """暂停目标"""
        with self.lock:
            self._send_rpc_unlocked("halt")

    def resume(self) -> None:
        """恢复目标运行"""
        with self.lock:
            self._send_rpc_unlocked("resume")

    def batch_read(self, nodes: list[VariableNode]) -> list[Any]:
        if not nodes:
            return []

        with self.lock:
            # 检查目标状态，运行时需要 halt 才能可靠读取内存
            raw_state = self._send_rpc_unlocked("capture \"targets\"")
            was_running = "halted" not in raw_state.lower()
            if was_running:
                self._send_rpc_unlocked("halt")

            try:
                # 记录原始索引，用于返回结果与输入对齐
                indexed_nodes = list(enumerate(nodes))
                sorted_indexed = sorted(indexed_nodes, key=lambda x: x[1].addr)
                results_list: list[Any] = [None] * len(nodes)
                MAX_MERGE_SIZE = 256  # 单次 mdb 读取上限，避免超大请求
                i = 0
                while i < len(sorted_indexed):
                    # 合并连续节点，限制总大小
                    group = [sorted_indexed[i]]
                    group_end = sorted_indexed[i][1].addr + sorted_indexed[i][1].size
                    j = i + 1
                    while j < len(sorted_indexed):
                        next_node = sorted_indexed[j][1]
                        if next_node.addr == group_end and (group_end - sorted_indexed[i][1].addr + next_node.size) <= MAX_MERGE_SIZE:
                            group.append(sorted_indexed[j])
                            group_end = next_node.addr + next_node.size
                            j += 1
                        else:
                            break

                    # 内联读取原始字节（避免调用 read_raw_bytes 导致重复获取锁）
                    start_addr = group[0][1].addr
                    total_size = group_end - start_addr
                    raw_res = self._send_rpc_unlocked(f'capture "mdb {hex(start_addr)} {total_size}"')
                    hex_tokens = []
                    try:
                        for line in raw_res.splitlines():
                            if ':' in line:
                                tokens = line.split(':', 1)[1].split()
                                for t in tokens:
                                    if len(t) == 2 and all(c in "0123456789abcdefABCDEF" for c in t):
                                        hex_tokens.append(t)
                        raw_bytes = bytes([int(h, 16) for h in hex_tokens[:total_size]])
                    except Exception:
                        raw_bytes = b""

                    # 从原始字节缓冲区中按各节点的 size 解析值
                    for orig_idx, node in group:
                        offset = node.addr - start_addr
                        if offset + node.size <= len(raw_bytes):
                            node_bytes = raw_bytes[offset:offset + node.size]
                            raw_int = int.from_bytes(node_bytes, byteorder='little')
                            results_list[orig_idx] = self._parse_raw_value(raw_int, node)
                        else:
                            results_list[orig_idx] = "N/A"

                    i += len(group)

                return [r if r is not None else "N/A" for r in results_list]
            finally:
                if was_running:
                    self._send_rpc_unlocked("resume")

    def read_raw_bytes(self, addr: int, size: int) -> bytes:
        """底层方法：使用 mdb 读取指定长度的纯字节流"""
        raw_res = self._send_rpc(f'capture "mdb {hex(addr)} {size}"')
        hex_tokens = []
        try:
            for line in raw_res.splitlines():
                if ':' in line:
                    tokens = line.split(':', 1)[1].split()
                    for t in tokens:
                        if len(t) == 2 and all(c in "0123456789abcdefABCDEF" for c in t):
                            hex_tokens.append(t)
            return bytes([int(h, 16) for h in hex_tokens[:size]])
        except Exception:
            return b""

    def _batch_read_raw_bytes(self, requests: list[tuple[int, int]]) -> list[bytes]:
        """批量读取原始字节，获取一次锁处理所有请求，减少锁竞争
        requests: [(addr, size), ...]
        返回: [bytes, ...] 与 requests 一一对应

        注意：OpenOCD TCL RPC 没有标准的批量内存读取接口，
        此处优化主要通过减少锁获取/释放次数来降低竞争开销。
        """
        if not requests:
            return []
        results: list[bytes] = []
        with self.lock:
            for addr, size in requests:
                raw_res = self._send_rpc_unlocked(f'capture "mdb {hex(addr)} {size}"')
                hex_tokens = []
                try:
                    for line in raw_res.splitlines():
                        if ':' in line:
                            tokens = line.split(':', 1)[1].split()
                            for t in tokens:
                                if len(t) == 2 and all(c in "0123456789abcdefABCDEF" for c in t):
                                    hex_tokens.append(t)
                    results.append(bytes([int(h, 16) for h in hex_tokens[:size]]))
                except Exception:
                    results.append(b"")
        return results

    def read_memory_bytes(self, addr: int, size: int) -> str:
        """使用 mdb 读取指定长度的内存并转为字符串"""
        try:
            byte_data = self.read_raw_bytes(addr, size)
            return byte_data.split(b'\x00')[0].decode('ascii', errors='ignore')
        except Exception:
            return "Decode Error"
    # def _parse_raw_int(self, raw_int: int, node: VariableNode) -> Any:
    #     try:
    #         if node.type == "float":
    #             return round(struct.unpack("<f", struct.pack("<I", raw_int))[0], 4)
    #         if node.size == 1:
    #             return raw_int & 0xFF
    #         if node.size == 2:
    #             return raw_int & 0xFFFF
    #         return raw_int
    #     except Exception:
    #         return "ERR"

    def _parse_raw_value(self, raw_int: int, node: VariableNode) -> Any:
        try:
            # 🔥 新增：通过类型名智能判定是否为无符号整数
            type_str = node.type_name.lower()
            # 枚举类型不做符号扩展，DWARF 中枚举值始终为逻辑值
            is_unsigned = node.type == "enum" or "unsigned" in type_str or "uint" in type_str

            # 1. 处理 1 字节整数 (int8_t, uint8_t, char)
            if node.size == 1:
                val = raw_int & 0xFF
                # 符号转换：如果是有符号类型，且最高位（0x80，即第8位）是1，说明是负数
                if not is_unsigned and (val & 0x80):
                    val -= 256
                
                # 如果是字符，同时附带 ASCII 显示
                if "char" in type_str and 32 <= val <= 126:
                    return f"{val} ('{chr(val)}')"
                return val

            # 2. 处理 2 字节整数 (int16_t, uint16_t, short)
            if node.size == 2:
                val = raw_int & 0xFFFF
                # 符号转换：最高位是 0x8000
                if not is_unsigned and (val & 0x8000):
                    val -= 65536
                return val

            # 3. 处理浮点数
            if node.type == "float":
                return round(struct.unpack("<f", struct.pack("<I", raw_int))[0], 4)

            # 4. 处理 4 字节整数 (int32_t, uint32_t, int)
            val = raw_int & 0xFFFFFFFF
            # 符号转换：最高位是 0x80000000
            if not is_unsigned and (val & 0x80000000):
                val -= 4294967296
            return val

        except Exception:
            return "ERR"

    def write(self, node: VariableNode, val: str) -> bool:
        try:
            # --- 1. 处理字符串写入 (char 数组) ---
            if node.type == "string":
                # 将输入字符串转为 ASCII 字节，确保不超过数组定义的 size
                encoded = val.encode("ascii", errors="ignore")[:node.size]
                # 如果字符串没填满数组，在末尾补一个 \0 字符
                if len(encoded) < node.size:
                    encoded += b"\x00"

                # 批量写入：每 4 字节用一次 mww，尾部不足 4 字节用 mwb
                addr = node.addr
                pos = 0
                while pos + 4 <= len(encoded):
                    word = int.from_bytes(encoded[pos:pos + 4], byteorder='little')
                    self._send_rpc(f"mww {hex(addr + pos)} {hex(word)}")
                    pos += 4
                while pos < len(encoded):
                    self._send_rpc(f"mwb {hex(addr + pos)} {hex(encoded[pos])}")
                    pos += 1
                return True

            # --- 2. 处理 8 字节数据 (Double / Int64) ---
            elif node.size == 8:
                # ... 保持你之前的 double/int64 写入逻辑不变 ...
                is_unsigned = "unsigned" in node.type_name.lower() or "uint" in node.type_name.lower()
                fmt = "<Q" if is_unsigned else "<q"
                if node.type == "double":
                    raw_bytes = struct.pack("<d", float(val))
                else:
                    raw_bytes = struct.pack(fmt, int(val, 0))
                val1, val2 = struct.unpack("<II", raw_bytes)
                self._send_rpc(f"mww {hex(node.addr)} {hex(val1)}")
                self._send_rpc(f"mww {hex(node.addr + 4)} {hex(val2)}")
                return True

            # --- 3. 处理普通 1/2/4 字节数据 ---
            else:
                cmd_type = "mww" if node.size >= 4 else "mwh" if node.size == 2 else "mwb"
                raw_value = struct.unpack("<I", struct.pack("<f", float(val)))[0] if node.type == "float" else int(val, 0)
                # 掩码确保非负，避免 hex() 产生 "-0x1" 这样的无效格式
                if node.size == 1:
                    raw_value &= 0xFF
                elif node.size == 2:
                    raw_value &= 0xFFFF
                elif node.size == 4:
                    raw_value &= 0xFFFFFFFF
                self._send_rpc(f"{cmd_type} {hex(node.addr)} {hex(raw_value)}")
                return True
        except Exception:
            return False


class ElfExpert:
    def __init__(self, path: str):
        self.verbose = False
        self.root_vars: dict[str, VariableNode] = {}
        # 记录根变量的基本信息，用于按需展开（懒加载）
        self.root_var_info: dict[str, tuple[int, int, int]] = {}  # name -> (addr, type_off, cu_off)
        # 优化#2：预计算的根变量类型信息缓存
        self.root_var_cache: dict[str, dict[str, Any]] = {}  # name -> {type_name, size, has_children}
        self.type_die_map: dict[tuple[int, int], Any] = {}
        self.type_abs_offset_map: dict[int, Any] = {}  # die.offset -> die，用于快速绝对偏移查找
        self.type_off_to_cu: dict[int, int] = {}  # 优化#1：反向索引，type_off -> 第一个 cu_off
        # DWARF 类型解析结果缓存，限制最大 1000 条目，超出时清空最旧的一半
        self._type_info_cache: collections.OrderedDict[tuple[int, int], dict[str, Any]] = collections.OrderedDict()
        self._type_info_cache_max = 1000
        self.type_definition_map: dict[tuple[Any, ...], Any] = {}
        with open(path, "rb") as file:
            elffile = ELFFile(file)
            dwarf = elffile.get_dwarf_info()
            symtab = elffile.get_section_by_name(".symtab")
            self.addr_map: dict[str, int] = {}
            if symtab:
                self.addr_map = {symbol.name: symbol["st_value"] for symbol in symtab.iter_symbols() if symbol.name}
            # 单次遍历：同时建图和收集变量
            for cu in dwarf.iter_CUs():
                for die in cu.iter_DIEs():
                    if die.tag:
                        self.type_die_map[(cu.cu_offset, die.offset)] = die
                        self.type_abs_offset_map[die.offset] = die
                        self.type_off_to_cu.setdefault(die.offset, cu.cu_offset)
                        self._register_type_definition(cu.cu_offset, die)
                    if die.tag == "DW_TAG_variable":
                        name_attr = self._get_attr(die, "DW_AT_name", cu.cu_offset)
                        type_attr, _, type_cu_off = self._get_attr_context(die, "DW_AT_type", cu.cu_offset)
                        if not (name_attr and type_attr):
                            continue
                        name = self._decode_attr_value(name_attr)
                        addr = self._resolve_variable_address(die, cu, self.addr_map)
                        if addr is None:
                            continue
                        # 使用 pyelftools 内置方法解析类型引用（AC5 跨 CU 兼容）
                        # 仅在变量收集阶段使用，展开路径仍用旧的手动偏移计算
                        type_ref = self._resolve_type_ref(die)
                        if type_ref:
                            type_die_obj, type_cu_off = type_ref
                            type_off = type_die_obj.offset
                        else:
                            type_off = self._resolve_type_offset(type_attr, type_cu_off)
                        self.root_var_info[name] = (addr, type_off, type_cu_off)
            # 优化#2：预计算每个根变量的类型信息，避免 list_roots 重复查找
            for name, (addr, type_off, cu_off) in self.root_var_info.items():
                self.root_var_cache[name] = self._resolve_type_info(type_off, cu_off)

    def _is_cpp_class(self, die: Any) -> bool:
        """判断 DW_TAG_structure_type 是否为 C++ class（AC5 兼容）。
        多重启发式检测：type_definition_map、成员函数、继承、访问修饰符、模板参数。"""
        if not die:
            return False
        # 方法 1：查找 type_definition_map 中是否有同名的 DW_TAG_class_type 定义
        # 注意：交叉注册会把 structure_type 也放到 class_type key 下，
        # 所以必须检查找到的 die 的 tag 是否真的是 DW_TAG_class_type
        type_name = self._decode_attr_string(die, "DW_AT_name")
        if type_name:
            tdm = getattr(self, "type_definition_map", {})
            class_die = tdm.get(("DW_TAG_class_type", type_name))
            if class_die and class_die.tag == "DW_TAG_class_type" and not self._is_declaration_die(class_die):
                return True
        # 方法 2：检查 C++ 特征子节点
        try:
            for child in die.iter_children():
                # 成员函数、继承、模板类型参数
                if child.tag in ("DW_TAG_subprogram", "DW_TAG_inheritance", "DW_TAG_template_type_parameter"):
                    return True
                # 访问修饰符（private/protected/public）—— C struct 无此属性
                if child.tag == "DW_TAG_member" and child.attributes.get("DW_AT_accessibility"):
                    return True
        except Exception:
            pass
        return False

    def _classify_type(self, die: Any) -> tuple[str, bool]:
        """根据 DWARF tag 确定类型分类，返回 (v_type, has_children)。
        AC5 会将 C++ class 编码为 DW_TAG_structure_type，通过启发式检测修正。"""
        if not die:
            return ("value", False)
        tag = die.tag
        if tag == "DW_TAG_array_type":
            return ("array", True)
        if tag == "DW_TAG_class_type":
            return ("class", True)
        if tag == "DW_TAG_union_type":
            return ("union", True)
        if tag == "DW_TAG_enumeration_type":
            return ("enum", False)
        if tag == "DW_TAG_structure_type":
            # AC5 兼容：检查是否有 C++ 特征（成员函数或继承）
            is_cpp = self._is_cpp_class(die)
            if is_cpp:
                return ("class", True)
            return ("struct", True)
        return ("value", False)

    def _resolve_type_info(self, type_off: int, cu_off: int) -> dict[str, Any]:
        """沿 typedef/const/volatile 链解析真实类型名、大小和 has_children"""
        # 检查缓存，避免重复解析同一类型
        cache_key = (cu_off, type_off)
        cached = self._type_info_cache.get(cache_key)
        if cached is not None:
            # 命中时移到末尾（标记为最近使用）
            self._type_info_cache.move_to_end(cache_key)
            return cached
        die = self._lookup_type_die(cu_off, type_off)
        if not die:
            return {"type_name": "", "size": 0, "has_children": False}
        # 获取初始类型名和大小
        name_attr = die.attributes.get("DW_AT_name")
        type_name = name_attr.value.decode("utf-8") if name_attr else ""
        byte_size = die.attributes.get("DW_AT_byte_size")
        size = byte_size.value if byte_size else 0
        # 沿修饰链追踪到真实类型，visited 防止环形引用导致死循环
        visited: set[int] = set()
        real_die = die
        while real_die and real_die.tag in ("DW_TAG_volatile_type", "DW_TAG_const_type", "DW_TAG_typedef"):
            if real_die.offset in visited:
                break
            visited.add(real_die.offset)
            next_type = real_die.attributes.get("DW_AT_type")
            if not next_type:
                break
            real_die_cu_off = self._die_cu_offset(real_die, cu_off)
            real_die = self._lookup_type_die(real_die_cu_off, self._resolve_type_offset(next_type, real_die_cu_off))
        if real_die:
            name_attr = real_die.attributes.get("DW_AT_name")
            if name_attr:
                type_name = name_attr.value.decode("utf-8")
            byte_size = real_die.attributes.get("DW_AT_byte_size")
            size = byte_size.value if byte_size else size
        # 使用统一的类型分类逻辑
        v_type, has_children = self._classify_type(real_die)
        result = {"type_name": type_name, "size": size, "has_children": has_children, "v_type": v_type}
        # 缓存容量检查：超出上限时清空最旧的一半
        if len(self._type_info_cache) >= self._type_info_cache_max:
            evict_count = self._type_info_cache_max // 2
            for _ in range(evict_count):
                self._type_info_cache.popitem(last=False)
        self._type_info_cache[cache_key] = result
        return result

    def _decode_attr_string(self, die: Any, attr_name: str) -> str | None:
        attr = die.attributes.get(attr_name)
        if not attr:
            return None
        return self._decode_attr_value(attr)

    def _decode_attr_value(self, attr: Any) -> str:
        if isinstance(attr.value, bytes):
            return attr.value.decode("utf-8", errors="ignore")
        return str(attr.value)

    def _die_cu_offset(self, die: Any, fallback_cu_off: int) -> int:
        die_cu = getattr(die, "cu", None)
        return getattr(die_cu, "cu_offset", fallback_cu_off)

    def _resolve_reference_die(self, attr: Any, cu_off: int) -> Any:
        type_off = self._resolve_type_offset(attr, cu_off)
        return self._lookup_type_die(cu_off, type_off)

    def _get_attr_context(self, die: Any, attr_name: str, cu_off: int, visited: set[int] | None = None) -> tuple[Any | None, Any, int]:
        attr = die.attributes.get(attr_name)
        if attr:
            return attr, die, cu_off

        if visited is None:
            visited = set()
        die_id = id(die)
        if die_id in visited:
            return None, die, cu_off
        visited.add(die_id)

        # C++ 调试信息常把成员或变量的 name/type 放在 specification/origin 指向的声明 DIE 上。
        for ref_attr_name in ("DW_AT_specification", "DW_AT_abstract_origin"):
            ref_attr = die.attributes.get(ref_attr_name)
            if not ref_attr:
                continue
            ref_die = self._resolve_reference_die(ref_attr, cu_off)
            if not ref_die:
                continue
            ref_cu_off = self._die_cu_offset(ref_die, cu_off)
            inherited_attr, inherited_die, inherited_cu_off = self._get_attr_context(ref_die, attr_name, ref_cu_off, visited)
            if inherited_attr:
                return inherited_attr, inherited_die, inherited_cu_off

        return None, die, cu_off

    def _get_attr(self, die: Any, attr_name: str, cu_off: int) -> Any:
        return self._get_attr_context(die, attr_name, cu_off)[0]

    def _is_declaration_die(self, die: Any) -> bool:
        declaration_attr = die.attributes.get("DW_AT_declaration")
        return bool(declaration_attr and declaration_attr.value)

    def _register_type_definition(self, cu_off: int, die: Any) -> None:
        if die.tag not in ("DW_TAG_structure_type", "DW_TAG_class_type", "DW_TAG_union_type"):
            return
        if self._is_declaration_die(die):
            return
        type_name = self._decode_attr_string(die, "DW_AT_name")
        if not type_name:
            return
        self.type_definition_map[(cu_off, die.tag, type_name)] = die
        self.type_definition_map[(die.tag, type_name)] = die
        # 同时注册互补 tag，解决 C++ 编译器 class/struct tag 不一致问题
        alt_tag = "DW_TAG_structure_type" if die.tag == "DW_TAG_class_type" else "DW_TAG_class_type"
        self.type_definition_map.setdefault((cu_off, alt_tag, type_name), die)
        self.type_definition_map.setdefault((alt_tag, type_name), die)

    def _find_full_type_definition(self, die: Any, cu_off: int) -> Any:
        if die.tag not in ("DW_TAG_structure_type", "DW_TAG_class_type", "DW_TAG_union_type"):
            return die
        if not self._is_declaration_die(die):
            return die
        type_name = self._decode_attr_string(die, "DW_AT_name")
        if not type_name:
            return die
        type_definition_map = getattr(self, "type_definition_map", {})
        # 尝试同 tag 查找
        result = (
            type_definition_map.get((cu_off, die.tag, type_name))
            or type_definition_map.get((die.tag, type_name))
        )
        if result:
            return result
        # C++ 编译器可能用 DW_TAG_class_type 声明但 DW_TAG_structure_type 定义（或反之），互查
        alt_tag = "DW_TAG_structure_type" if die.tag == "DW_TAG_class_type" else "DW_TAG_class_type"
        result = (
            type_definition_map.get((cu_off, alt_tag, type_name))
            or type_definition_map.get((alt_tag, type_name))
        )
        return result or die

    def _resolve_type_offset(self, type_attr: Any, cu_off: int) -> int:
        if getattr(type_attr, "form", "") == "DW_FORM_ref_addr":
            return type_attr.value
        return type_attr.value + cu_off

    def _resolve_type_ref(self, die: Any, attr_name: str = "DW_AT_type") -> tuple[Any, int] | None:
        """解析类型引用，优先用 pyelftools 内置方法（AC5 跨 CU 兼容），失败时回退到手动偏移计算
        返回 (type_die, type_cu_off) 或 None
        仅用于变量收集阶段，不用于 _expand_node 等展开路径"""
        attr = die.attributes.get(attr_name)
        if not attr:
            return None
        # 优先使用 pyelftools 内置方法（AC5/AC6 兼容）
        try:
            type_die = die.get_DIE_from_attribute(attr_name)
            if type_die:
                type_cu_off = getattr(getattr(type_die, 'cu', None), 'cu_offset', 0)
                return (type_die, type_cu_off)
        except Exception:
            pass
        # 回退：手动计算偏移 + _lookup_type_die（兼容 C++ 跨 CU 引用等边缘情况）
        cu_off = getattr(getattr(die, 'cu', None), 'cu_offset', 0)
        type_off = self._resolve_type_offset(attr, cu_off)
        type_die = self._lookup_type_die(cu_off, type_off)
        if type_die:
            type_cu_off = getattr(getattr(type_die, 'cu', None), 'cu_offset', cu_off)
            return (type_die, type_cu_off)
        return None

    def _lookup_type_die(self, cu_off: int, type_off: int) -> Any:
        """查找类型 DIE，兼容 AC5/AC6 的 DWARF 偏移编码差异"""
        # 精确查找 (cu_off, type_off)
        die = self.type_die_map.get((cu_off, type_off))
        if die:
            return die
        # 通过反向索引查找
        candidate_cu = self.type_off_to_cu.get(type_off)
        if candidate_cu is not None:
            die = self.type_die_map.get((candidate_cu, type_off))
            if die:
                return die
        # AC5 fallback：type_off 可能是 CU 相对偏移（未加 cu_off）或绝对偏移
        # 尝试 type_off + cu_off（CU 相对 → 绝对）
        abs_off = type_off + cu_off
        die = self.type_die_map.get((cu_off, abs_off))
        if die:
            return die
        # 通过绝对偏移索引快速查找
        die = self.type_abs_offset_map.get(type_off)
        if die:
            return die
        if self.verbose:
            sys.stderr.write(f"[LOOKUP-FAIL] cu_off={cu_off:#x}, type_off={type_off:#x}, abs_off={abs_off:#x}\n")
            sys.stderr.write(f"  candidate_cu={candidate_cu}\n")
            sys.stderr.flush()
        return None

    def _parse_location_address(self, expr: Any, cu: Any) -> int | None:
        if expr is None:
            return None
        try:
            # pyelftools 可能用 LocationExpr 包装，提取原始字节
            if isinstance(expr, LocationExpr):
                expr = expr.loc_expr
            if isinstance(expr, int):
                # AC5 可能用 DW_FORM_data4/data8 存储 .debug_loc 偏移
                # 尝试从 location lists 解析
                if self.verbose:
                    sys.stderr.write(f"[LOC] expr is int (offset={expr:#x}), trying location_lists\n")
                    sys.stderr.flush()
                try:
                    loc_lists = cu.dwarfinfo.location_lists()
                    loc_list = loc_lists.get_location_list_at_offset(expr, cu)
                    if loc_list:
                        for entry in loc_list:
                            if hasattr(entry, 'loc_expr') and entry.loc_expr:
                                ops = DWARFExprParser(cu.structs).parse_expr(entry.loc_expr)
                                if ops and ops[0].op_name == "DW_OP_addr" and ops[0].args:
                                    return int(ops[0].args[0])
                except Exception:
                    pass
                return None
            expr_bytes = expr if isinstance(expr, bytes) else bytes(expr)
            ops = DWARFExprParser(cu.structs).parse_expr(expr_bytes)
            if not ops:
                return None
            op = ops[0]
            if op.op_name == "DW_OP_addr" and op.args:
                return int(op.args[0])
            if op.op_name in ("DW_OP_addrx", "DW_OP_GNU_addr_index") and op.args:
                return int(cu.dwarfinfo.get_addr(cu, op.args[0]))
        except Exception:
            return None
        return None

    def _resolve_variable_address(self, die: Any, cu: Any, addr_map: dict[str, int]) -> int | None:
        cu_off = getattr(cu, "cu_offset", 0)
        name_attr = self._get_attr(die, "DW_AT_name", cu_off)
        var_name = self._decode_attr_value(name_attr) if name_attr else "<unknown>"
        loc_attr = die.attributes.get("DW_AT_location")
        if loc_attr:
            addr = self._parse_location_address(loc_attr.value, cu)
            if addr is not None:
                return addr

        for attr_name in ("DW_AT_linkage_name", "DW_AT_MIPS_linkage_name", "DW_AT_name"):
            name_attr = self._get_attr(die, attr_name, cu_off)
            name = self._decode_attr_value(name_attr) if name_attr else None
            addr = self._find_symbol_address(name, addr_map)
            if addr is not None:
                return addr

        return None

    def _find_symbol_address(self, name: str | None, addr_map: dict[str, int]) -> int | None:
        if not name:
            return None
        if name in addr_map:
            return addr_map[name]

        candidates = []
        for symbol_name, addr in addr_map.items():
            if symbol_name.endswith(name) or name in symbol_name:
                candidates.append((len(symbol_name), addr))
        if not candidates:
            return None
        candidates.sort(key=lambda item: item[0])
        return candidates[0][1]

    def _parse_member_offset(self, attr: Any, cu: Any) -> int | None:
        value = attr.value
        if isinstance(value, int):
            return value
        try:
            ops = DWARFExprParser(cu.structs).parse_expr(bytes(value))
            if ops and ops[0].op_name == "DW_OP_plus_uconst" and ops[0].args:
                return int(ops[0].args[0])
        except Exception:
            pass
        return None

    def _fill_array_children(self, parent_node: VariableNode, base_addr: int, dims: list[int], type_off: int, cu_off: int, depth: int, elem_size: int):
        """
        递归填充数组子节点。
        dims: 剩余维度的列表，例如 [2, 3] 表示当前是 2x3 的数组
        elem_size: 最小单个元素的字节大小
        """
        count = dims[0] # 当前维度的元素个数
        # 计算当前维度下，每一个元素的跨度（Stride）
        # 例如 int a[2][3]，第一层的 stride 是 3个int的大小，即 12字节
        stride = elem_size * (math.prod(dims[1:]) if len(dims) > 1 else 1)
        
        for i in range(count):
            current_addr = base_addr + i * stride
            index_str = f"[{i}]"
            
            if len(dims) > 1:
                # 还有下一维，创建一个中间容器节点
                child_type_name = f"sub_array_{len(dims)-1}"
                sub_node = VariableNode(index_str, current_addr, "array", 0, child_type_name)
                # 递归处理下一维
                self._fill_array_children(sub_node, current_addr, dims[1:], type_off, cu_off, depth + 1, elem_size)
                parent_node.children[index_str] = sub_node
            else:
                # 最后一维，创建真实的元素节点（如 int 或 struct）
                leaf_node = self._expand_node(index_str, current_addr, type_off, cu_off, depth + 1)
                if leaf_node:
                    parent_node.children[index_str] = leaf_node

    # 递归展开节点
    def _expand_node(self, name: str, addr: int, type_off: int, cu_off: int, depth: int) -> VariableNode | None:
        if depth > 15:
            return None

        die = self._lookup_type_die(cu_off, type_off)
        if not die:
            return None

        name_attr = die.attributes.get("DW_AT_name")
        type_name = name_attr.value.decode("utf-8") if name_attr else ""

        # 统一获取当前类型的字节大小 (重要：用于步长计算)
        byte_size = die.attributes.get("DW_AT_byte_size")
        current_size = byte_size.value if byte_size else 0

        # --- 1. 处理修饰类型 ---
        if die.tag in ("DW_TAG_volatile_type", "DW_TAG_const_type", "DW_TAG_typedef"):
            next_type = die.attributes.get("DW_AT_type")
            if not next_type:
                return None
            resolved_type_attr = self._resolve_type_offset(next_type, cu_off)
            node = self._expand_node(name, addr, resolved_type_attr, cu_off, depth + 1)
            if node and not node.type_name:
                node.type_name = type_name
            return node

        # --- 2. 处理基础类型 ---
        if die.tag == "DW_TAG_base_type":
            type_lower = type_name.lower()
            if "float" in type_lower:
                value_type = "float"
            elif "double" in type_lower:
                value_type = "double"  # 新增识别 double
            else:
                value_type = "int"
            return VariableNode(name, addr, value_type, current_size, type_name)

        # --- 3. 处理枚举类型 ---
        if die.tag == "DW_TAG_enumeration_type":
            enum_values = {}
            for child in die.iter_children():
                if child.tag != "DW_TAG_enumerator":
                    continue
                enum_name = child.attributes.get("DW_AT_name")
                enum_value = child.attributes.get("DW_AT_const_value")
                if enum_name and enum_value:
                    enum_values[int(enum_value.value)] = enum_name.value.decode("utf-8")
            return VariableNode(name, addr, "enum", current_size or 4, type_name or "enum", enum_values)

        # --- 4. 处理数组类型 ---
        if die.tag == "DW_TAG_array_type":
            element_type_attr = die.attributes.get("DW_AT_type")
            if not element_type_attr: return None
            
            dimensions = []
            for child in die.iter_children():
                if child.tag == "DW_TAG_subrange_type":
                    count = child.attributes.get("DW_AT_count")
                    if count:
                        dimensions.append(count.value)
                        continue
                    ubound = child.attributes.get("DW_AT_upper_bound")
                    if ubound:
                        lower_bound = child.attributes.get("DW_AT_lower_bound")
                        lower_value = lower_bound.value if lower_bound else 0
                        dimensions.append(ubound.value - lower_value + 1)
            
            if not dimensions: return None
            
            # 获取元素节点以获取其 size
            element_type_off = self._resolve_type_offset(element_type_attr, cu_off)
            element_node = self._expand_node(f"{name}[0]", addr, element_type_off, cu_off, depth + 1)
            if not element_node: return None

            # 判定：如果是 char 类型的 1 维数组，标记为 string
            is_char = "char" in element_node.type_name.lower()
            is_1d = len(dimensions) == 1
            v_type = "string" if (is_char and is_1d) else "array"

            total_size = element_node.size * math.prod(dimensions)
            
            # 🔥 修复 1：修改传递给前端的 typeName 标识
            if v_type == "string":
                # 显示为 "string (char[20])"，既明确类型，又防止内存越界瞎写
                display_type_name = f"string ({element_node.type_name}[{dimensions[0]}])"
            else:
                display_type_name = f"{element_node.type_name}[{']['.join(map(str, dimensions))}]"
            
            array_node = VariableNode(name, addr, v_type, total_size, display_type_name)
            
            # 🔥 修复 2：斩断子节点！如果被判定为 string，绝不允许它往下生成 [0], [1]...
            if math.prod(dimensions) <= 256 and v_type != "string":
                self._fill_array_children(array_node, addr, dimensions, element_type_off, cu_off, depth, element_node.size)
                
            return array_node

            
        # --- 5. 处理结构体和 C++ 类 ---
        if die.tag in ("DW_TAG_structure_type", "DW_TAG_class_type", "DW_TAG_union_type"):
            orig_die = die
            die = self._find_full_type_definition(die, cu_off)
            # 关键修复：_find_full_type_definition 可能返回不同 CU 的 DIE
            # 成员的 DW_AT_type 引用相对于成员所在 CU，必须用该 CU 的偏移来解析
            die_cu_off = self._die_cu_offset(die, cu_off)
            is_decl = self._is_declaration_die(die)
            name_attr = die.attributes.get("DW_AT_name")
            type_name = name_attr.value.decode("utf-8") if name_attr else type_name
            byte_size = die.attributes.get("DW_AT_byte_size")
            current_size = byte_size.value if byte_size else current_size

            # 关键修复：current_size 必须从 DWARF 读取，不能固定为 0
            # 使用统一的类型分类逻辑（含 AC5 C++ class 启发式检测）
            v_type, _ = self._classify_type(die)
            struct_node = VariableNode(name, addr, v_type, current_size, type_name or v_type)
            skipped_members = []
            for child in die.iter_children():
                if child.tag == "DW_TAG_member":
                    m_name = self._get_attr(child, "DW_AT_name", cu_off)
                    m_loc, m_loc_die, _ = self._get_attr_context(child, "DW_AT_data_member_location", cu_off)
                    # 类型引用必须用 die_cu_off 解析，因为成员 DIE 属于找到的定义所在的 CU
                    m_type, _, _ = self._get_attr_context(child, "DW_AT_type", die_cu_off)
                    if not (m_name and m_type):
                        skip_name = self._decode_attr_value(m_name) if m_name else "<no_name>"
                        skipped_members.append(f"{skip_name}:missing_name_or_type(name={bool(m_name)},type={bool(m_type)})")
                        continue

                    declaration_attr = child.attributes.get("DW_AT_declaration")
                    external_attr = child.attributes.get("DW_AT_external")
                    # C++ 静态成员同时有 DW_AT_external 和 DW_AT_declaration，必须先检查 external
                    if external_attr and not m_loc:
                        # C++ 静态成员：尝试从符号表解析地址
                        static_addr = self._resolve_variable_address(child, die.cu, self.addr_map)
                        if static_addr is None:
                            skipped_members.append(f"{self._decode_attr_value(m_name)}:static_no_addr")
                            continue
                        member_name = self._decode_attr_value(m_name)
                        resolved_type_off = self._resolve_type_offset(m_type, die_cu_off)
                        child_node = self._expand_node(member_name, static_addr, resolved_type_off, die_cu_off, depth + 1)
                        if child_node:
                            struct_node.children[member_name] = child_node
                        else:
                            skipped_members.append(f"{member_name}:static_expand_failed")
                        continue

                    # 非静态成员的声明（前向声明），跳过
                    if declaration_attr and bool(declaration_attr.value):
                        skipped_members.append(f"{self._decode_attr_value(m_name)}:declaration")
                        continue

                    if m_loc:
                        # 解析成员偏移量，兼容 C++ 类成员的表达式形式
                        offset = self._parse_member_offset(m_loc, getattr(m_loc_die, "cu", die.cu))
                        if offset is None:
                            skipped_members.append(f"{self._decode_attr_value(m_name)}:bad_offset")
                            continue
                    else:
                        # C++ 类第一个非静态成员可能省略位置属性，等价于偏移 0
                        offset = 0

                    member_name = self._decode_attr_value(m_name)
                    resolved_type_off = self._resolve_type_offset(m_type, die_cu_off)
                    child_node = self._expand_node(member_name, addr + offset, resolved_type_off, die_cu_off, depth + 1)
                    if child_node:
                        struct_node.children[member_name] = child_node
                    else:
                        # 诊断：成员展开失败，记录该成员的类型信息
                        m_type_die = self._lookup_type_die(die_cu_off, resolved_type_off)
                        m_type_tag = m_type_die.tag if m_type_die else "NOT_FOUND"
                        m_type_name_attr = m_type_die.attributes.get("DW_AT_name") if m_type_die else None
                        m_type_name_str = m_type_name_attr.value.decode("utf-8") if m_type_name_attr else ""
                        skipped_members.append(f"{member_name}:expand_returned_none(type_tag={m_type_tag},type_name='{m_type_name_str}',attr_form={getattr(m_type,'form','?')},attr_val=0x{m_type.value:x},cu_off=0x{die_cu_off:x},resolved=0x{resolved_type_off:x})")
            return struct_node

        # --- 6. 处理指针类型 ---
        if die.tag == "DW_TAG_pointer_type":
            ptr_size = current_size or 4  # ARM32 默认 4 字节
            display_type = type_name + "*" if type_name else "void*"
            return VariableNode(name, addr, "int", ptr_size, display_type)

        return None

class DebugDataServer:
    def __init__(self, elf_path: str, host: str, port: int, verbose: bool = False):
        self.elf_path = str(Path(elf_path))
        self.rpc = TclRpcClient(host=host, port=port)
        self.expert = ElfExpert(self.elf_path)
        self.expert.verbose = verbose

    def list_roots(self) -> list[dict[str, Any]]:
        """返回根变量列表，不展开子节点（懒加载）"""
        results = []
        for name in sorted(self.expert.root_var_info.keys()):
            addr, _, _ = self.expert.root_var_info[name]
            # 优化#2：直接读取预计算的类型信息，不再每次做类型查找
            cached = self.expert.root_var_cache.get(name, {})
            type_name = cached.get("type_name", "")
            size = cached.get("size", 0)
            has_children = cached.get("has_children", False)
            v_type = cached.get("v_type", "struct" if has_children else "value")
            results.append({
                "name": name,
                "path": name,
                "address": hex(addr),
                "type": v_type,
                "typeName": type_name,
                "size": size,
                "hasChildren": has_children,
                "children": [],
            })
        return results

    def resolve_path(self, path: str) -> VariableNode | None:
        """解析变量路径，支持懒加载展开（包括 C++ 类类型）"""
        if not path:
            return None

        norm_path = path.replace("[", ".[")
        parts = [p for p in norm_path.split(".") if p]
        if not parts:
            return None

        root_name = parts[0]

        # 确保根节点已展开（懒加载）
        if root_name not in self.expert.root_vars:
            if root_name in self.expert.root_var_info:
                addr, type_off, cu_off = self.expert.root_var_info[root_name]
                node = self.expert._expand_node(root_name, addr, type_off, cu_off, 0)
                if node:
                    self.expert.root_vars[root_name] = node
            else:
                # C++ 类/结构体可能没有 DW_TAG_variable，尝试从类型定义展开
                class_node = self._try_expand_class_type(root_name)
                if class_node:
                    self.expert.root_vars[root_name] = class_node

        current = self.expert.root_vars.get(root_name)
        for part in parts[1:]:
            if not current:
                return None
            current = current.children.get(part)

        return current

    def _try_expand_class_type(self, type_name: str) -> VariableNode | None:
        """尝试将类/结构体类型名展开为虚拟根节点（用于 C++ 静态成员类）"""
        tdm = getattr(self.expert, "type_definition_map", {})
        # 尝试 class_type 和 structure_type 两种 tag
        for tag in ("DW_TAG_class_type", "DW_TAG_structure_type", "DW_TAG_union_type"):
            die = tdm.get((tag, type_name))
            if die:
                die_cu_off = self.expert._die_cu_offset(die, 0)
                node = self.expert._expand_node(type_name, 0, die.offset, die_cu_off, 0)
                if node and node.children:
                    return node
        return None

    def describe(self, path: str) -> dict[str, Any] | None:
        node = self.resolve_path(path)
        if node:
            summary = node.to_summary(path)
            return summary
        return None

    def list_children(self, path: str) -> list[dict[str, Any]] | None:
        node = self.resolve_path(path)
        if not node:
            return None
        if not node.children:
            return []
        results = []
        for name, child in node.children.items():
            child_path = f"{path}{'' if name.startswith('[') else '.'}{name}"
            results.append(child.to_summary(child_path))
        return results

    def _dump_all_dwarf_vars(self) -> list[dict[str, Any]]:
        """诊断：列出 ELF 中所有 DW_TAG_variable 条目的详细信息"""
        results = []
        with open(self.elf_path, "rb") as f:
            elffile = ELFFile(f)
            dwarf = elffile.get_dwarf_info()
            for cu in dwarf.iter_CUs():
                for die in cu.iter_DIEs():
                    if die.tag != "DW_TAG_variable":
                        continue
                    name_attr = die.attributes.get("DW_AT_name")
                    name = self.expert._decode_attr_value(name_attr) if name_attr else "<no_name>"
                    type_attr = die.attributes.get("DW_AT_type")
                    loc_attr = die.attributes.get("DW_AT_location")
                    loc_form = getattr(loc_attr, 'form', None) if loc_attr else None
                    loc_type = type(loc_attr.value).__name__ if loc_attr else None
                    in_root = name in self.expert.root_var_info
                    results.append({
                        "name": name,
                        "has_type": type_attr is not None,
                        "has_loc": loc_attr is not None,
                        "loc_form": str(loc_form),
                        "loc_value_type": loc_type,
                        "in_root_vars": in_root,
                    })
        return results

    def read_paths(self, paths: list[str]) -> list[dict[str, Any]]:
        results = []
        # 分离普通变量和字符串变量
        normal_nodes = []
        # 收集需要批量读取的请求（字符串和 64 位值），减少锁竞争
        batch_requests: list[tuple[int, int]] = []  # (addr, size)
        batch_meta: list[tuple[int, str, VariableNode | None]] = []  # (results索引, 类型标记, node引用)

        for path in paths:
            node = self.resolve_path(path)
            if not node:
                results.append({"path": path, "value": None, "address": "0x0"})
                continue

            if node.type == "string":
                idx = len(results)
                results.append({"path": path, "value": None, "address": hex(node.addr)})
                batch_requests.append((node.addr, node.size))
                batch_meta.append((idx, "string", None))

            # 8 字节的整数 (int64/uint64) 和 double
            elif node.type == "double" or (node.type == "int" and node.size == 8):
                idx = len(results)
                results.append({"path": path, "value": None, "address": hex(node.addr)})
                batch_requests.append((node.addr, 8))
                batch_meta.append((idx, "raw64", node))

            elif node.type in ("struct", "class", "union"):
                results.append({"path": path, "value": "{...}", "address": hex(node.addr)})
            else:
                normal_nodes.append((path, node))

        # 批量读取字符串和 64 位值的原始字节（一次获取锁，减少锁竞争）
        if batch_requests:
            raw_results = self.rpc._batch_read_raw_bytes(batch_requests)
            for i, raw_bytes in enumerate(raw_results):
                idx, kind, node = batch_meta[i]
                if kind == "string":
                    # 字符串：截断到第一个 \0，解码为 ASCII
                    results[idx]["value"] = raw_bytes.split(b'\x00')[0].decode('ascii', errors='ignore')
                else:  # raw64
                    if len(raw_bytes) == 8:
                        if node.type == "double":
                            val = round(struct.unpack("<d", raw_bytes)[0], 4)
                        else:
                            # 判定是否有符号：<Q 是无符号 64 位，<q 是有符号 64 位
                            is_unsigned = "unsigned" in node.type_name.lower() or "uint" in node.type_name.lower()
                            fmt = "<Q" if is_unsigned else "<q"
                            val = struct.unpack(fmt, raw_bytes)[0]
                        results[idx]["value"] = str(val)
                    else:
                        results[idx]["value"] = "ERR"

        # 普通变量继续使用原来的批量读取优化
        if normal_nodes:
            nodes_only = [n[1] for n in normal_nodes]
            values = self.rpc.batch_read(nodes_only)
            for idx, (path, node) in enumerate(normal_nodes):
                value = values[idx]
                if node.type == "enum" and isinstance(value, int) and value in node.enum_values:
                    value = f"{value}/{node.enum_values[value]}"
                results.append({"path": path, "value": value, "address": hex(node.addr)})

        # 按输入 paths 顺序排列结果（保留重复路径）
        result_map: dict[str, list[dict[str, Any]]] = {}
        for r in results:
            result_map.setdefault(r["path"], []).append(r)
        ordered: list[dict[str, Any]] = []
        for p in paths:
            bucket = result_map.get(p)
            if bucket:
                ordered.append(bucket.pop(0))
        return ordered
        
    def write_value(self, path: str, value: str) -> bool:
        node = self.resolve_path(path)
        return bool(node and node.type not in ("struct", "class", "union") and self.rpc.write(node, value))

    def handle(self, request: dict[str, Any]) -> dict[str, Any]:
        command = request.get("command")
        if command == "ping":
            return {"ok": True, "result": {"message": "pong"}}
        if command == "list_all_dwarf_vars":
            # 诊断命令：列出 ELF 中所有 DW_TAG_variable 条目
            return {"ok": True, "result": self._dump_all_dwarf_vars()}
        if command == "list_roots":
            return {"ok": True, "result": self.list_roots()}
        if command == "describe":
            path = request.get("path", "")
            result = self.describe(path)
            return {"ok": True, "result": result} if result else {"ok": False, "error": f"Variable not found: {path}"}
        if command == "list_children":
            path = request.get("path", "")
            result = self.list_children(path)  # 只调用一次
            if result is not None:
                return {"ok": True, "result": result}
            else:
                return {"ok": False, "error": f"Variable not found: {path}"}

        if command == "read_paths":
            return {"ok": True, "result": self.read_paths(request.get("paths", []))}
        if command == "write":
            path = request.get("path", "")
            value = str(request.get("value", ""))
            return {"ok": True, "result": {"path": path, "value": value}} if self.write_value(path, value) else {"ok": False, "error": f"Write failed for {path}"}
        if command == "is_server_ready":
            # 持锁 + 轻量 RPC 验证连通性，修复 TOCTOU 竞态条件
            is_ready = self.rpc.is_connected()
            return {"ok": True, "result": {"ready": is_ready}}
        return {"ok": False, "error": f"Unknown command: {command}"}


def serve_stdio(server: DebugDataServer) -> int:
    while True:
        try:
            line = sys.stdin.readline()
            if not line: break # 管道关闭
            line = line.strip()
            if not line: continue
            
            response = server.handle(json.loads(line))
            print(json.dumps(response, ensure_ascii=False), flush=True)
        except Exception as exc:
            # 即使报错也要返回 JSON，防止前端 JSON.parse 崩溃
            print(json.dumps({"ok": False, "error": str(exc)}), flush=True)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="STM32 debug data backend for VS Code")
    parser.add_argument("--elf", required=True, help="Path to ELF file")
    parser.add_argument("--host", default="127.0.0.1", help="OpenOCD TCL RPC host")
    parser.add_argument("--port", type=int, default=50001, help="OpenOCD TCL RPC port")
    parser.add_argument("--verbose", action="store_true", help="Enable diagnostic logging")
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    sys.stderr.write(f"server.py starting, elf={args.elf}\n")
    sys.stderr.flush()
    try:
        server = DebugDataServer(elf_path=args.elf, host=args.host, port=args.port, verbose=args.verbose)
        sys.stderr.write(f"ELF loaded, {len(server.expert.root_var_info)} root vars (lazy)\n")
        sys.stderr.flush()
    except Exception as e:
        import traceback
        sys.stderr.write(f"Failed to initialize: {e}\n")
        sys.stderr.write(traceback.format_exc())
        sys.stderr.flush()
        raise SystemExit(1)
    raise SystemExit(serve_stdio(server))
