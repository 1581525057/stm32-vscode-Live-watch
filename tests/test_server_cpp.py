import unittest

from elftools.dwarf.structs import DWARFStructs

from resources.server import DebugDataServer, ElfExpert


class FakeAttr:
    def __init__(self, value):
        self.value = value


class FakeCu:
    def __init__(self):
        self.cu_offset = 0
        self.structs = DWARFStructs(little_endian=True, dwarf_format=32, address_size=4)
        self.dwarfinfo = None


class FakeDie:
    def __init__(self, tag, attrs=None, children=None, offset=0, cu=None):
        self.tag = tag
        self.attributes = attrs or {}
        self._children = children or []
        self.offset = offset
        self.cu = cu

    def iter_children(self):
        return iter(self._children)


def str_attr(value):
    return FakeAttr(value.encode("utf-8"))


class FakeRpc:
    def __init__(self, values):
        self.values = values

    def batch_read(self, nodes):
        return self.values[:len(nodes)]


class ElfExpertCppTests(unittest.TestCase):
    def test_expand_node_treats_cpp_class_like_struct(self):
        cu = FakeCu()
        int_die = FakeDie(
            "DW_TAG_base_type",
            {
                "DW_AT_name": str_attr("int"),
                "DW_AT_byte_size": FakeAttr(4),
            },
            offset=1,
            cu=cu,
        )
        class_die = FakeDie(
            "DW_TAG_class_type",
            {
                "DW_AT_name": str_attr("Motor"),
                "DW_AT_byte_size": FakeAttr(8),
            },
            [
                FakeDie(
                    "DW_TAG_member",
                    {
                        "DW_AT_name": str_attr("speed"),
                        "DW_AT_data_member_location": FakeAttr(4),
                        "DW_AT_type": FakeAttr(1),
                    },
                    cu=cu,
                )
            ],
            offset=2,
            cu=cu,
        )

        expert = object.__new__(ElfExpert)
        expert.type_die_map = {(0, 1): int_die, (0, 2): class_die}

        node = expert._expand_node("motor", 0x20000000, 2, 0, 0)

        self.assertIsNotNone(node)
        self.assertEqual("struct", node.type)
        self.assertIn("speed", node.children)
        self.assertEqual(0x20000004, node.children["speed"].addr)

    def test_expand_cpp_class_members_keeps_nested_struct_and_count_array_children(self):
        cu = FakeCu()
        int_die = FakeDie(
            "DW_TAG_base_type",
            {
                "DW_AT_name": str_attr("int"),
                "DW_AT_byte_size": FakeAttr(4),
            },
            offset=1,
            cu=cu,
        )
        config_die = FakeDie(
            "DW_TAG_structure_type",
            {
                "DW_AT_name": str_attr("Config"),
                "DW_AT_byte_size": FakeAttr(4),
            },
            [
                FakeDie(
                    "DW_TAG_member",
                    {
                        "DW_AT_name": str_attr("gain"),
                        "DW_AT_data_member_location": FakeAttr(0),
                        "DW_AT_type": FakeAttr(1),
                    },
                    cu=cu,
                )
            ],
            offset=2,
            cu=cu,
        )
        config_array_die = FakeDie(
            "DW_TAG_array_type",
            {"DW_AT_type": FakeAttr(2)},
            [
                FakeDie(
                    "DW_TAG_subrange_type",
                    {"DW_AT_count": FakeAttr(2)},
                    cu=cu,
                )
            ],
            offset=3,
            cu=cu,
        )
        class_die = FakeDie(
            "DW_TAG_class_type",
            {
                "DW_AT_name": str_attr("Motor"),
                "DW_AT_byte_size": FakeAttr(16),
            },
            [
                FakeDie(
                    "DW_TAG_member",
                    {
                        "DW_AT_name": str_attr("config"),
                        "DW_AT_data_member_location": FakeAttr(0),
                        "DW_AT_type": FakeAttr(2),
                    },
                    cu=cu,
                ),
                FakeDie(
                    "DW_TAG_member",
                    {
                        "DW_AT_name": str_attr("history"),
                        "DW_AT_data_member_location": FakeAttr(4),
                        "DW_AT_type": FakeAttr(3),
                    },
                    cu=cu,
                ),
            ],
            offset=4,
            cu=cu,
        )

        expert = object.__new__(ElfExpert)
        expert.type_die_map = {
            (0, 1): int_die,
            (0, 2): config_die,
            (0, 3): config_array_die,
            (0, 4): class_die,
        }

        node = expert._expand_node("motor", 0x20000000, 4, 0, 0)

        self.assertIsNotNone(node)
        self.assertIn("config", node.children)
        self.assertIn("gain", node.children["config"].children)
        self.assertIn("history", node.children)
        self.assertIn("[0]", node.children["history"].children)
        self.assertIn("gain", node.children["history"].children["[0]"].children)
        self.assertEqual(0x20000004, node.children["history"].children["[0]"].addr)
        self.assertEqual(0x20000008, node.children["history"].children["[1]"].addr)

    def test_list_children_returns_paths_for_nested_cpp_array_struct_members(self):
        cu = FakeCu()
        int_die = FakeDie(
            "DW_TAG_base_type",
            {
                "DW_AT_name": str_attr("int"),
                "DW_AT_byte_size": FakeAttr(4),
            },
            offset=1,
            cu=cu,
        )
        config_die = FakeDie(
            "DW_TAG_structure_type",
            {
                "DW_AT_name": str_attr("Config"),
                "DW_AT_byte_size": FakeAttr(4),
            },
            [
                FakeDie(
                    "DW_TAG_member",
                    {
                        "DW_AT_name": str_attr("gain"),
                        "DW_AT_data_member_location": FakeAttr(0),
                        "DW_AT_type": FakeAttr(1),
                    },
                    cu=cu,
                )
            ],
            offset=2,
            cu=cu,
        )
        config_array_die = FakeDie(
            "DW_TAG_array_type",
            {"DW_AT_type": FakeAttr(2)},
            [
                FakeDie(
                    "DW_TAG_subrange_type",
                    {"DW_AT_count": FakeAttr(2)},
                    cu=cu,
                )
            ],
            offset=3,
            cu=cu,
        )
        class_die = FakeDie(
            "DW_TAG_class_type",
            {
                "DW_AT_name": str_attr("Motor"),
                "DW_AT_byte_size": FakeAttr(16),
            },
            [
                FakeDie(
                    "DW_TAG_member",
                    {
                        "DW_AT_name": str_attr("history"),
                        "DW_AT_data_member_location": FakeAttr(4),
                        "DW_AT_type": FakeAttr(3),
                    },
                    cu=cu,
                )
            ],
            offset=4,
            cu=cu,
        )

        expert = object.__new__(ElfExpert)
        expert.type_die_map = {
            (0, 1): int_die,
            (0, 2): config_die,
            (0, 3): config_array_die,
            (0, 4): class_die,
        }
        expert.root_vars = {
            "motor": expert._expand_node("motor", 0x20000000, 4, 0, 0)
        }
        server = object.__new__(DebugDataServer)
        server.expert = expert

        history_children = server.list_children("motor.history")
        self.assertIsNotNone(history_children)
        first_item_children = server.list_children("motor.history[0]")
        self.assertIsNotNone(first_item_children)

        self.assertEqual("motor.history[0]", history_children[0]["path"])
        self.assertEqual("motor.history[0].gain", first_item_children[0]["path"])

    def test_parse_location_address_reads_dw_op_addr(self):
        cu = FakeCu()
        expert = object.__new__(ElfExpert)

        addr = expert._parse_location_address([3, 0x78, 0x56, 0x34, 0x12], cu)

        self.assertEqual(0x12345678, addr)

    def test_read_paths_formats_known_enum_value_with_name(self):
        cu = FakeCu()
        enum_die = FakeDie(
            "DW_TAG_enumeration_type",
            {
                "DW_AT_name": str_attr("State"),
                "DW_AT_byte_size": FakeAttr(4),
            },
            [
                FakeDie(
                    "DW_TAG_enumerator",
                    {
                        "DW_AT_name": str_attr("state_nb"),
                        "DW_AT_const_value": FakeAttr(0),
                    },
                    cu=cu,
                )
            ],
            offset=1,
            cu=cu,
        )
        expert = object.__new__(ElfExpert)
        expert.type_die_map = {(0, 1): enum_die}
        expert.root_vars = {
            "state": expert._expand_node("state", 0x20000000, 1, 0, 0)
        }
        server = object.__new__(DebugDataServer)
        server.expert = expert
        server.rpc = FakeRpc([0])

        results = server.read_paths(["state"])

        self.assertEqual("0/state_nb", results[0]["value"])

    def test_read_paths_keeps_unknown_enum_value_numeric(self):
        cu = FakeCu()
        enum_die = FakeDie(
            "DW_TAG_enumeration_type",
            {
                "DW_AT_name": str_attr("State"),
                "DW_AT_byte_size": FakeAttr(4),
            },
            [
                FakeDie(
                    "DW_TAG_enumerator",
                    {
                        "DW_AT_name": str_attr("state_nb"),
                        "DW_AT_const_value": FakeAttr(0),
                    },
                    cu=cu,
                )
            ],
            offset=1,
            cu=cu,
        )
        expert = object.__new__(ElfExpert)
        expert.type_die_map = {(0, 1): enum_die}
        expert.root_vars = {
            "state": expert._expand_node("state", 0x20000000, 1, 0, 0)
        }
        server = object.__new__(DebugDataServer)
        server.expert = expert
        server.rpc = FakeRpc([7])

        results = server.read_paths(["state"])

        self.assertEqual(7, results[0]["value"])


if __name__ == "__main__":
    unittest.main()
