import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class ProductionSmokeTests(unittest.TestCase):
    def test_backend_env_template_exists(self):
        self.assertTrue((ROOT / 'backend' / '.env.example').exists(), 'backend/.env.example is required for secure production config')

    def test_frontend_env_template_exists(self):
        self.assertTrue((ROOT / 'frontend' / '.env.example').exists(), 'frontend/.env.example is required for production-safe frontend config')

    def test_react_router_future_flags_are_enabled(self):
        app_source = (ROOT / 'frontend' / 'src' / 'App.jsx').read_text(encoding='utf-8')
        self.assertIn('v7_startTransition', app_source)
        self.assertIn('v7_relativeSplatPath', app_source)


if __name__ == '__main__':
    unittest.main()
