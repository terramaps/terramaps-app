"""API app setup.

This file is responsible for initializing the FastAPI object and setting up any configuration such as middlewares, logging config, etc.
"""

from fastapi import FastAPI
from fastapi.middleware.trustedhost import TrustedHostMiddleware

from src.app.analytics import configure_analytics
from src.app.exceptions import configure_exceptions
from src.app.openapi import configure_openapi

from .config import app_settings
from .cors import configure_cors
from .logging import configure_logging

app = FastAPI(title="Terramaps API", debug=app_settings.debug)

# Trust the X-Forwarded-* headers from your proxies/load balancers
app.add_middleware(TrustedHostMiddleware, allowed_hosts=["*"])

# Additional configurations
configure_cors(app=app)
configure_logging(app=app)
configure_openapi(app=app)
configure_exceptions(app=app)
configure_analytics(app=app)
