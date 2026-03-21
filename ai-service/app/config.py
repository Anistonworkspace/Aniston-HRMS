from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "Aniston HRMS AI Service"
    api_key: str = ""
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    ragflow_api_url: str = ""
    ragflow_api_key: str = ""

    class Config:
        env_file = ".env"


settings = Settings()
