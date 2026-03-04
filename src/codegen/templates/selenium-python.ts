export function seleniumPythonTemplate(): Record<string, string> {
  return {
    ['requirements.txt']: `selenium>=4.20.0
pytest>=8.0.0
webdriver-manager>=4.0.0
`,

    ['pytest.ini']: `[pytest]
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
`,

    ['conftest.py']: `import pytest
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options


@pytest.fixture
def driver():
    options = Options()
    # options.add_argument("--headless")
    driver = webdriver.Chrome(options=options)
    driver.implicitly_wait(10)
    yield driver
    driver.quit()
`,

    ['tests/test_example.py']: `from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


class TestExample:
    def test_page_loads(self, driver):
        driver.get("http://localhost:3000")
        assert driver.title is not None

    def test_element_visible(self, driver):
        driver.get("http://localhost:3000")
        body = driver.find_element(By.TAG_NAME, "body")
        assert body.is_displayed()
`,

    ['tests/pages/base_page.py']: `from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


class BasePage:
    def __init__(self, driver):
        self.driver = driver
        self.wait = WebDriverWait(driver, 10)

    def navigate(self, url):
        self.driver.get(url)

    def get_title(self):
        return self.driver.title
`,

    ['.gitignore']: `__pycache__/
*.pyc
.pytest_cache/
htmlcov/
.venv/
`,
  };
}
