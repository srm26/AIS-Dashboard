import json
from pydantic_settings import BaseSettings
from typing import Dict, List


class Settings(BaseSettings):
    azure_subscription_ids: str  # comma-separated
    azure_resource_groups: str = ""  # comma-separated, empty = all
    # Optional: JSON map of function app name → App Insights App ID, for apps
    # where automatic detection fails (e.g. SP lacks config/appsettings/list).
    # Example: {"fa-wus2-filemover-dv-01":"abc123-...", "fa-other":"def456-..."}
    azure_function_ai_overrides: str = "{}"
    # Optional: client ID of a user-assigned managed identity.
    # Leave unset to use the system-assigned managed identity.
    azure_managed_identity_client_id: str = ""
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    frontend_origin: str = "http://localhost:3000"
    # Auth — secret used to sign JWTs issued after Azure AD SSO login
    auth_secret_key: str = "change-me-to-a-random-secret"
    # Azure AD SSO (App Service Easy Auth)
    azure_ad_enabled: bool = False
    azure_ad_tenant_id: str = ""
    azure_ad_client_id: str = ""
    azure_ad_admin_group_id: str = ""
    azure_ad_viewer_group_id: str = ""

    @property
    def function_ai_overrides(self) -> Dict[str, str]:
        try:
            return json.loads(self.azure_function_ai_overrides)
        except Exception:
            return {}

    @property
    def subscription_ids(self) -> List[str]:
        return [s.strip() for s in self.azure_subscription_ids.split(",") if s.strip()]

    @property
    def resource_group_filter(self) -> List[str]:
        return [r.strip() for r in self.azure_resource_groups.split(",") if r.strip()]

    class Config:
        env_file = ".env"


settings = Settings()
