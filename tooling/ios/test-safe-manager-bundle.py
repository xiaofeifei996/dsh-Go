#!/usr/bin/env python3
"""Contract tests for the built-in iOS dsh-purge-safe plugin bundle."""
from pathlib import Path
import ast
import json
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]


class SafeManagerBundleContract(unittest.TestCase):
    def test_specializer_copies_the_complete_plugin(self):
        source = (ROOT / "tooling/ios/specialize-runtime.py").read_text()
        tree = ast.parse(source)
        mapping = None
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(
                isinstance(target, ast.Name) and target.id == "SAFE_MANAGER_FILES"
                for target in node.targets
            ):
                mapping = ast.literal_eval(node.value)
                break
        self.assertIsNotNone(mapping, "SAFE_MANAGER_FILES mapping is missing")
        expected = {
            "runtime/ios/dsh-purge-safe/package.json": "examples/plugins/dsh-purge-safe/package.json",
            "runtime/ios/dsh-purge-safe/NOTICE.md": "examples/plugins/dsh-purge-safe/NOTICE.md",
            "runtime/ios/dsh-purge-safe/lib/index.js": "examples/plugins/dsh-purge-safe/lib/index.js",
            "runtime/ios/dsh-purge-safe/lib/store.js": "examples/plugins/dsh-purge-safe/lib/store.js",
            "runtime/ios/dsh-purge-safe/lib/view.js": "examples/plugins/dsh-purge-safe/lib/view.js",
        }
        self.assertEqual(mapping, expected)
        self.assertIn("relocation.update(", source)

    def test_ios_startup_registers_the_bundled_entrypoint(self):
        source = (ROOT / "app/ios/Runner/EngineChannel.swift").read_text()
        self.assertIn('appendingPathComponent("runtime/ios/dsh-purge-safe/lib/index.js")', source)
        self.assertRegex(source, r'insertions\.append\(\[\s*"id":\s*"dsh-purge-safe"')
        self.assertIn('if !insertions.isEmpty { entries = [["insert": insertions]] }', source)
        self.assertIn('"dsh-go-ios-phone"', source)

    def test_plugin_declares_the_native_service_and_relative_modules(self):
        package = json.loads((ROOT / "examples/plugins/dsh-purge-safe/package.json").read_text())
        self.assertEqual(package.get("name"), "dsh-purge-safe")
        entry = (ROOT / "examples/plugins/dsh-purge-safe/lib/index.js").read_text()
        self.assertIn("import { SafeStore } from './store.js';", entry)
        self.assertIn("import { managerView, panelData } from './view.js';", entry)
        self.assertRegex(entry, r"ctx\.inject\(\s*\[['\"]dshGo['\"]\]")
        self.assertIn("ctx.dshGo.panel('manager'", entry)


if __name__ == "__main__":
    unittest.main()
