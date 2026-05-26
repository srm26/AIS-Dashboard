from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    azure_tenant_id: str
    azure_client_id: str
    azure_client_secret: str
    azure_subscription_ids: str  # comma-separated
    azure_resource_groups: str = ""  # comma-separated, empty = all
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    frontend_origin: str = "http://localhost:3000"

    @property
    def subscription_ids(self) -> List[str]:
        return [s.strip() for s in self.azure_subscription_ids.split(",") if s.strip()]

    @property
    def resource_group_filter(self) -> List[str]:
        return [r.strip() for r in self.azure_resource_groups.split(",") if r.strip()]

    class Config:
        env_file = ".env"


settings = Settings()
