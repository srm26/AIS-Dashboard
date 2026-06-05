from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    azure_subscription_ids: str  # comma-separated
    azure_resource_groups: str = ""  # comma-separated, empty = all
    # Optional: client ID of a user-assigned managed identity.
    # Leave unset to use the system-assigned managed identity.
    azure_managed_identity_client_id: str = ""
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    frontend_origin: str = "http://localhost:3000"
    # Auth — comma-separated entries: username:password:role
    # Roles: admin (can resubmit/enable/disable), viewer (read-only)
    auth_secret_key: str = "change-me-to-a-random-secret"
    auth_users: str = ""  # e.g. alice:pass1:admin,bob:pass2:viewer

    @property
    def subscription_ids(self) -> List[str]:
        return [s.strip() for s in self.azure_subscription_ids.split(",") if s.strip()]

    @property
    def resource_group_filter(self) -> List[str]:
        return [r.strip() for r in self.azure_resource_groups.split(",") if r.strip()]

    class Config:
        env_file = ".env"


settings = Settings()
