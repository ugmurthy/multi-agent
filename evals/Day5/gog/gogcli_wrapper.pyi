"""
Type stubs for GOG CLI Wrapper

This file provides type hints for better IDE support and type checking.
"""

from typing import Optional, Dict, Any, List, Union
from dataclasses import dataclass
from enum import Enum


class GOGCommand(Enum):
    """Enum of allowed GOG CLI commands."""
    SEARCH = "search"
    DETAILS = "details"
    LIBRARY = "library"
    INSTALLED = "installed"
    NEWS = "news"
    CATEGORIES = "categories"
    GENRES = "genres"
    WISHLIST = "wishlist"
    REACH = "reach"
    REACH_ADD = "reach add"
    REACH_REMOVE = "reach remove"
    REACH_INFO = "reach info"
    AUTH = "auth"
    AUTH_STATUS = "auth status"
    AUTH_LOGIN = "auth login"
    AUTH_LOGOUT = "auth logout"
    ACCOUNT = "account"
    ACCOUNT_INFO = "account info"
    ACCOUNT_EMAIL = "account email"
    ACCOUNT_PASSWORD = "account password"
    ACCOUNT_LANGUAGE = "account language"
    ACCOUNT_REGION = "account region"


@dataclass
class GOGCommandConfig:
    """Configuration for a GOG CLI command."""
    name: str
    description: str
    parameters: Dict[str, Dict[str, Any]]
    requires_auth: bool
    read_only: bool


@dataclass
class ExecutionResult:
    """Result of a gogcli execution."""
    success: bool
    command: str
    stdout: str
    stderr: str
    parsed_data: Optional[Dict[str, Any]]
    raw_output: str
    execution_time: float
    error: Optional[str]
    retry_count: int
    rate_limited: bool


class GOGCLIError(Exception):
    """Base exception for GOG CLI wrapper."""
    pass


class AuthenticationError(GOGCLIError):
    """Raised when authentication fails."""
    pass


class RateLimitError(GOGCLIError):
    """Raised when rate limit is exceeded."""
    pass


class CommandNotAllowedError(GOGCLIError):
    """Raised when a command is not in the allowlist."""
    pass


class ExecutionTimeoutError(GOGCLIError):
    """Raised when command execution times out."""
    pass


class ParseError(GOGCLIError):
    """Raised when output parsing fails."""
    pass


class GOGCLIWrapper:
    """Production-ready wrapper for gogcli with agentic framework support."""
    
    def __init__(
        self,
        gogcli_path: Optional[str] = None,
        timeout: int = 60,
        max_retries: int = 3,
        initial_backoff: float = 1.0,
        max_backoff: float = 60.0,
        allowed_commands: Optional[List[str]] = None,
        enable_logging: bool = True,
        log_level: int = 20,
    ) -> None:
        """Initialize the GOG CLI wrapper."""
        pass
    
    def execute(
        self,
        command: Union[GOGCommand, str],
        **kwargs: Any
    ) -> ExecutionResult:
        """Execute a gogcli command with full error handling and retries."""
        pass
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get execution metrics."""
        pass
    
    def is_authenticated(self) -> bool:
        """Check if currently authenticated."""
        pass
    
    def get_allowed_commands(self) -> List[str]:
        """Get list of allowed commands."""
        pass
    
    def add_allowed_command(self, command: str) -> None:
        """Add a command to the allowlist."""
        pass
    
    def remove_allowed_command(self, command: str) -> None:
        """Remove a command from the allowlist."""
        pass


@dataclass
class ToolSchema:
    """Generic tool schema for custom agentic frameworks."""
    name: str
    description: str
    parameters: Dict[str, Dict[str, Any]]
    requires_auth: bool
    read_only: bool
    example: Dict[str, Any]


def create_wrapper(
    gogcli_path: Optional[str] = None,
    timeout: int = 60,
    max_retries: int = 3,
    allowed_commands: Optional[List[str]] = None,
) -> GOGCLIWrapper:
    """Create a configured GOGCLIWrapper instance."""
    pass


def search_games(
    query: str,
    wrapper: Optional[GOGCLIWrapper] = None,
    **kwargs: Any
) -> Dict[str, Any]:
    """Search for games on GOG."""
    pass


def get_product_details(
    product_id: str,
    wrapper: Optional[GOGCLIWrapper] = None
) -> Dict[str, Any]:
    """Get detailed information about a product."""
    pass


def get_library(
    wrapper: Optional[GOGCLIWrapper] = None,
    **kwargs: Any
) -> Dict[str, Any]:
    """Get the user's GOG library."""
    pass


def get_all_tool_schemas() -> List[ToolSchema]:
    """Get tool schemas for all available commands."""
    pass


# LangChain integration types
try:
    from langchain.tools import BaseTool, StructuredTool
    
    def create_langchain_tools(wrapper: GOGCLIWrapper) -> List[BaseTool]:
        """Create a list of LangChain tools for all available commands."""
        pass
    
    def create_gog_search_tool(wrapper: GOGCLIWrapper) -> StructuredTool:
        """Create a structured LangChain tool for GOG search."""
        pass

except ImportError:
    pass


# CrewAI integration types
try:
    from crewai.tools import BaseTool as CrewAITool
    
    def create_crewai_tools(wrapper: GOGCLIWrapper) -> List[CrewAITool]:
        """Create a list of CrewAI tools for all available commands."""
        pass

except ImportError:
    pass


# LlamaIndex integration types
try:
    from llama_index.core.tools import FunctionTool
    
    def create_llamaindex_tools(wrapper: GOGCLIWrapper) -> List[FunctionTool]:
        """Create a list of LlamaIndex tools for all available commands."""
        pass

except ImportError:
    pass
