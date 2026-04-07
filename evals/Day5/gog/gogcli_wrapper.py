"""
GOG CLI Wrapper for Agentic Frameworks

A production-ready Python wrapper for gogcli that integrates with LangChain,
CrewAI, LlamaIndex, and other agentic frameworks.

Features:
- Subprocess execution with timeout and error handling
- JSON output parsing with fallback
- Rate limit handling with exponential backoff
- Credential management via environment variables
- Tool schemas for LangChain/CrewAI/LlamaIndex
- Command allowlist enforcement
- Logging and observability
"""

import subprocess
import json
import os
import time
import logging
from typing import Optional, Dict, Any, List, Union
from dataclasses import dataclass, field
from enum import Enum
from abc import ABC, abstractmethod
import re
import hashlib

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


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
    PURCHASES = "purchases"
    PURCHASES_LIST = "purchases list"
    PURCHASES_DETAILS = "purchases details"
    GAMES = "games"
    GAMES_LIST = "games list"
    GAMES_DETAILS = "games details"
    GAMES_ADD = "games add"
    GAMES_REMOVE = "games remove"
    GAMES_ACTIVATE = "games activate"
    GAMES_ACTIVATE_KEY = "games activate key"
    GAMES_ACTIVATE_FILE = "games activate file"
    GAMES_ACTIVATE_URL = "games activate url"
    GAMES_ACTIVATE_CODE = "games activate code"
    GAMES_ACTIVATE_PRODUCT = "games activate product"
    GAMES_ACTIVATE_LICENCE = "games activate licence"
    GAMES_ACTIVATE_LICENCE_KEY = "games activate licence key"
    GAMES_ACTIVATE_LICENCE_FILE = "games activate licence file"
    GAMES_ACTIVATE_LICENCE_URL = "games activate licence url"
    GAMES_ACTIVATE_LICENCE_CODE = "games activate licence code"
    GAMES_ACTIVATE_LICENCE_PRODUCT = "games activate licence product"
    GAMES_ACTIVATE_LICENCE_LICENCE = "games activate licence licence"
    GAMES_ACTIVATE_LICENCE_LICENCE_KEY = "games activate licence licence key"
    GAMES_ACTIVATE_LICENCE_LICENCE_FILE = "games activate licence licence file"
    GAMES_ACTIVATE_LICENCE_LICENCE_URL = "games activate licence licence url"
    GAMES_ACTIVATE_LICENCE_LICENCE_CODE = "games activate licence licence code"
    GAMES_ACTIVATE_LICENCE_LICENCE_PRODUCT = "games activate licence licence product"


@dataclass
class GOGCommandConfig:
    """Configuration for a GOG CLI command."""
    name: str
    description: str
    parameters: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    requires_auth: bool = False
    read_only: bool = True


# Define command configurations
COMMAND_CONFIGS: Dict[GOGCommand, GOGCommandConfig] = {
    GOGCommand.SEARCH: GOGCommandConfig(
        name="search",
        description="Search for games, software, and DLCs on GOG",
        parameters={
            "query": {"type": "string", "description": "Search query", "required": True},
            "page": {"type": "integer", "description": "Page number", "required": False, "default": 1},
            "limit": {"type": "integer", "description": "Results per page", "required": False, "default": 20},
        },
        requires_auth=False,
        read_only=True
    ),
    GOGCommand.DETAILS: GOGCommandConfig(
        name="details",
        description="Get detailed information about a specific product",
        parameters={
            "product_id": {"type": "string", "description": "Product ID or slug", "required": True},
        },
        requires_auth=False,
        read_only=True
    ),
    GOGCommand.LIBRARY: GOGCommandConfig(
        name="library",
        description="List all games in your GOG library",
        parameters={
            "page": {"type": "integer", "description": "Page number", "required": False, "default": 1},
            "limit": {"type": "integer", "description": "Games per page", "required": False, "default": 50},
        },
        requires_auth=True,
        read_only=True
    ),
    GOGCommand.INSTALLED: GOGCommandConfig(
        name="installed",
        description="List all installed games",
        parameters={},
        requires_auth=False,
        read_only=True
    ),
    GOGCommand.NEWS: GOGCommandConfig(
        name="news",
        description="Get latest GOG news and updates",
        parameters={
            "page": {"type": "integer", "description": "Page number", "required": False, "default": 1},
            "limit": {"type": "integer", "description": "News items per page", "required": False, "default": 10},
        },
        requires_auth=False,
        read_only=True
    ),
    GOGCommand.CATEGORIES: GOGCommandConfig(
        name="categories",
        description="List all available categories",
        parameters={},
        requires_auth=False,
        read_only=True
    ),
    GOGCommand.GENRES: GOGCommandConfig(
        name="genres",
        description="List all available genres",
        parameters={},
        requires_auth=False,
        read_only=True
    ),
    GOGCommand.WISHLIST: GOGCommandConfig(
        name="wishlist",
        description="List items in your wishlist",
        parameters={
            "page": {"type": "integer", "description": "Page number", "required": False, "default": 1},
            "limit": {"type": "integer", "description": "Items per page", "required": False, "default": 50},
        },
        requires_auth=True,
        read_only=True
    ),
    GOGCommand.AUTH_STATUS: GOGCommandConfig(
        name="auth_status",
        description="Check current authentication status",
        parameters={},
        requires_auth=False,
        read_only=True
    ),
    GOGCommand.ACCOUNT_INFO: GOGCommandConfig(
        name="account_info",
        description="Get account information",
        parameters={},
        requires_auth=True,
        read_only=True
    ),
}


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
    error: Optional[str] = None
    retry_count: int = 0
    rate_limited: bool = False


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
    """
    Production-ready wrapper for gogcli with agentic framework support.
    
    This wrapper provides:
    - Safe subprocess execution with timeout
    - JSON output parsing with fallback
    - Rate limit handling with exponential backoff
    - Credential management via environment variables
    - Command allowlist enforcement
    - Comprehensive logging
    """
    
    def __init__(
        self,
        gogcli_path: Optional[str] = None,
        timeout: int = 60,
        max_retries: int = 3,
        initial_backoff: float = 1.0,
        max_backoff: float = 60.0,
        allowed_commands: Optional[List[str]] = None,
        enable_logging: bool = True,
        log_level: int = logging.INFO,
    ):
        """
        Initialize the GOG CLI wrapper.
        
        Args:
            gogcli_path: Path to gogcli executable. Defaults to 'gogcli' in PATH.
            timeout: Command execution timeout in seconds.
            max_retries: Maximum number of retries for rate-limited requests.
            initial_backoff: Initial backoff time in seconds for exponential backoff.
            max_backoff: Maximum backoff time in seconds.
            allowed_commands: List of allowed commands. If None, uses default allowlist.
            enable_logging: Whether to enable logging.
            log_level: Logging level.
        """
        self.gogcli_path = gogcli_path or "gogcli"
        self.timeout = timeout
        self.max_retries = max_retries
        self.initial_backoff = initial_backoff
        self.max_backoff = max_backoff
        self.enable_logging = enable_logging
        self.log_level = log_level
        
        # Set up logging
        if enable_logging:
            self.logger = logging.getLogger(f"{__name__}.GOGCLIWrapper")
            self.logger.setLevel(log_level)
        
        # Command allowlist
        self.allowed_commands = allowed_commands or [cmd.value for cmd in GOGCommand]
        
        # Rate limit tracking
        self._last_request_time: float = 0
        self._rate_limit_window: float = 1.0  # 1 second window
        self._requests_in_window: int = 0
        self._window_start: float = time.time()
        
        # Metrics
        self._metrics = {
            "total_requests": 0,
            "successful_requests": 0,
            "failed_requests": 0,
            "rate_limited_requests": 0,
            "total_retries": 0,
            "total_execution_time": 0.0,
        }
    
    def _get_credentials(self) -> Dict[str, str]:
        """
        Get credentials from environment variables.
        
        Returns:
            Dictionary of credential environment variables.
        """
        credentials = {}
        
        # GOG CLI specific environment variables
        cred_vars = [
            "GOGCLI_TOKEN",
            "GOGCLI_ACCESS_TOKEN",
            "GOGCLI_REFRESH_TOKEN",
            "GOGCLI_USERNAME",
            "GOGCLI_PASSWORD",
            "GOG_CLI_TOKEN",
            "GOG_CLI_ACCESS_TOKEN",
            "GOGCLI_HOME",
            "GOG_CLI_HOME",
            "GOGCLI_CONFIG",
            "GOG_CLI_CONFIG",
        ]
        
        for var in cred_vars:
            if var in os.environ:
                # Mask sensitive values in logs
                value = os.environ[var]
                if "TOKEN" in var or "PASSWORD" in var:
                    credentials[var] = self._mask_secret(value)
                else:
                    credentials[var] = value
        
        return credentials
    
    def _mask_secret(self, secret: str, visible_chars: int = 4) -> str:
        """Mask a secret value for logging."""
        if len(secret) <= visible_chars * 2:
            return "*" * len(secret)
        return secret[:visible_chars] + "*" * (len(secret) - visible_chars * 2) + secret[-visible_chars:]
    
    def _check_rate_limit(self) -> bool:
        """
        Check if we should rate limit the request.
        
        Returns:
            True if we should wait, False if we can proceed.
        """
        current_time = time.time()
        
        # Reset window if needed
        if current_time - self._window_start >= self._rate_limit_window:
            self._window_start = current_time
            self._requests_in_window = 0
        
        # Check if we're over the limit (simple 10 requests per second)
        if self._requests_in_window >= 10:
            return True
        
        self._requests_in_window += 1
        return False
    
    def _exponential_backoff(self, attempt: int) -> float:
        """Calculate exponential backoff delay."""
        delay = self.initial_backoff * (2 ** attempt)
        # Add jitter
        jitter = delay * 0.1 * (hashlib.md5(str(time.time()).encode()).hexdigest()[:8], )[0] / 256
        return min(self.max_backoff, delay + jitter)
    
    def _is_command_allowed(self, command: str) -> bool:
        """Check if a command is in the allowlist."""
        return command in self.allowed_commands
    
    def _build_command(self, command: GOGCommand, **kwargs) -> List[str]:
        """
        Build the command line for gogcli.
        
        Args:
            command: The GOGCommand enum value.
            **kwargs: Command parameters.
            
        Returns:
            List of command line arguments.
        """
        cmd = [self.gogcli_path]
        
        # Add JSON output flag
        cmd.append("--json")
        
        # Add the main command
        cmd.append(command.value)
        
        # Add parameters
        config = COMMAND_CONFIGS.get(command)
        if config:
            for param_name, param_config in config.parameters.items():
                if param_name in kwargs:
                    value = kwargs[param_name]
                    if value is not None:
                        cmd.extend([param_name, str(value)])
                elif param_config.get("required", False):
                    raise ValueError(f"Required parameter '{param_name}' not provided")
        
        return cmd
    
    def _execute_command(self, cmd: List[str]) -> ExecutionResult:
        """
        Execute a command via subprocess.
        
        Args:
            cmd: Command line arguments as a list.
            
        Returns:
            ExecutionResult with the output.
        """
        start_time = time.time()
        
        # Get credentials for environment
        env = os.environ.copy()
        env.update(self._get_credentials())
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout,
                env=env,
                check=False,  # Don't raise on non-zero exit
            )
            
            execution_time = time.time() - start_time
            
            return ExecutionResult(
                success=result.returncode == 0,
                command=" ".join(cmd),
                stdout=result.stdout,
                stderr=result.stderr,
                parsed_data=None,
                raw_output=result.stdout,
                execution_time=execution_time,
            )
            
        except subprocess.TimeoutExpired:
            raise ExecutionTimeoutError(f"Command timed out after {self.timeout} seconds")
        except FileNotFoundError:
            raise GOGCLIError(f"gogcli not found at path: {self.gogcli_path}")
        except Exception as e:
            raise GOGCLIError(f"Failed to execute command: {str(e)}")
    
    def _parse_json_output(self, output: str) -> Optional[Dict[str, Any]]:
        """
        Parse JSON output with fallback strategies.
        
        Args:
            output: Raw output string.
            
        Returns:
            Parsed JSON as dictionary, or None if parsing fails.
        """
        if not output:
            return None
        
        # Try direct JSON parsing
        try:
            return json.loads(output)
        except json.JSONDecodeError:
            pass
        
        # Try to find JSON in the output (in case of mixed output)
        json_match = re.search(r'\{.*\}|\[.*\]', output, re.DOTALL)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass
        
        # Return None if all parsing attempts fail
        return None
    
    def _handle_rate_limit(self, attempt: int) -> None:
        """Handle rate limiting with exponential backoff."""
        backoff_time = self._exponential_backoff(attempt)
        self.logger.warning(f"Rate limit encountered. Retrying in {backoff_time:.2f}s (attempt {attempt + 1}/{self.max_retries})")
        time.sleep(backoff_time)
    
    def execute(
        self,
        command: Union[GOGCommand, str],
        **kwargs
    ) -> ExecutionResult:
        """
        Execute a gogcli command with full error handling and retries.
        
        Args:
            command: GOGCommand enum or command string.
            **kwargs: Command parameters.
            
        Returns:
            ExecutionResult with the output.
            
        Raises:
            CommandNotAllowedError: If command is not in allowlist.
            ExecutionTimeoutError: If command times out.
            GOGCLIError: For other execution errors.
        """
        # Convert string to GOGCommand if needed
        if isinstance(command, str):
            try:
                command_enum = GOGCommand(command)
            except ValueError:
                command_enum = None
        
        # Check command allowlist
        cmd_value = command.value if isinstance(command, GOGCommand) else command
        if not self._is_command_allowed(cmd_value):
            raise CommandNotAllowedError(f"Command '{cmd_value}' is not in the allowed commands list")
        
        # Build command
        try:
            cmd = self._build_command(command_enum or GOGCommand.SEARCH, **kwargs)
        except ValueError as e:
            raise GOGCLIError(str(e))
        
        # Execute with retries
        last_error = None
        retry_count = 0
        rate_limited = False
        
        for attempt in range(self.max_retries + 1):
            # Check rate limit
            if self._check_rate_limit() and attempt > 0:
                self._handle_rate_limit(attempt - 1)
                rate_limited = True
            
            try:
                result = self._execute_command(cmd)
                
                # Update metrics
                self._metrics["total_requests"] += 1
                self._metrics["total_execution_time"] += result.execution_time
                
                if result.success:
                    self._metrics["successful_requests"] += 1
                    # Parse JSON output
                    result.parsed_data = self._parse_json_output(result.stdout)
                    return result
                else:
                    self._metrics["failed_requests"] += 1
                    last_error = result.stderr
                    
                    # Check for rate limit in response
                    if "rate limit" in result.stderr.lower() or "too many requests" in result.stderr.lower():
                        if attempt < self.max_retries:
                            self._metrics["rate_limited_requests"] += 1
                            self._handle_rate_limit(attempt)
                            continue
                    
            except ExecutionTimeoutError:
                self._metrics["failed_requests"] += 1
                last_error = str(e)
                if attempt < self.max_retries:
                    self._handle_rate_limit(attempt)
                    continue
            except GOGCLIError as e:
                self._metrics["failed_requests"] += 1
                last_error = str(e)
                if attempt < self.max_retries:
                    self._handle_rate_limit(attempt)
                    continue
            except Exception as e:
                self._metrics["failed_requests"] += 1
                last_error = str(e)
                if attempt < self.max_retries:
                    self._handle_rate_limit(attempt)
                    continue
            
            retry_count += 1
            self._metrics["total_retries"] += 1
        
        # All retries exhausted
        return ExecutionResult(
            success=False,
            command=" ".join(cmd),
            stdout="",
            stderr=last_error or "Unknown error",
            parsed_data=None,
            raw_output="",
            execution_time=0,
            error=last_error,
            retry_count=retry_count,
            rate_limited=rate_limited,
        )
    
    def get_metrics(self) -> Dict[str, Any]:
        """Get execution metrics."""
        metrics = self._metrics.copy()
        if metrics["total_requests"] > 0:
            metrics["success_rate"] = metrics["successful_requests"] / metrics["total_requests"]
            metrics["avg_execution_time"] = metrics["total_execution_time"] / metrics["total_requests"]
        return metrics
    
    def is_authenticated(self) -> bool:
        """Check if currently authenticated."""
        result = self.execute(GOGCommand.AUTH_STATUS)
        if result.success and result.parsed_data:
            return result.parsed_data.get("authenticated", False)
        return False
    
    def get_allowed_commands(self) -> List[str]:
        """Get list of allowed commands."""
        return self.allowed_commands.copy()
    
    def add_allowed_command(self, command: str) -> None:
        """Add a command to the allowlist."""
        if command not in self.allowed_commands:
            self.allowed_commands.append(command)
            self.logger.info(f"Added '{command}' to allowed commands")
    
    def remove_allowed_command(self, command: str) -> None:
        """Remove a command from the allowlist."""
        if command in self.allowed_commands:
            self.allowed_commands.remove(command)
            self.logger.info(f"Removed '{command}' from allowed commands")


# =============================================================================
# LangChain Integration
# =============================================================================

try:
    from langchain.tools import BaseTool
    from langchain.tools import StructuredTool
    from pydantic import BaseModel, Field
    
    class GOGSearchInput(BaseModel):
        """Input schema for GOG search."""
        query: str = Field(..., description="Search query for games, software, and DLCs")
        page: int = Field(default=1, description="Page number")
        limit: int = Field(default=20, description="Results per page")
    
    class GOGDetailsInput(BaseModel):
        """Input schema for GOG product details."""
        product_id: str = Field(..., description="Product ID or slug")
    
    class GOGLibraryInput(BaseModel):
        """Input schema for GOG library."""
        page: int = Field(default=1, description="Page number")
        limit: int = Field(default=50, description="Games per page")
    
    class GOGWishlistInput(BaseModel):
        """Input schema for GOG wishlist."""
        page: int = Field(default=1, description="Page number")
        limit: int = Field(default=50, description="Items per page")
    
    class GOGAccountInfoInput(BaseModel):
        """Input schema for GOG account info."""
        pass
    
    class GOGCLILangChainTool(BaseTool):
        """
        LangChain tool for GOG CLI operations.
        
        Usage:
            wrapper = GOGCLIWrapper()
            tool = GOGCLILangChainTool(wrapper=wrapper, command="search")
            result = tool.run({"query": "cyberpunk"})
        """
        
        wrapper: GOGCLIWrapper = Field(exclude=True)
        command: str = Field(description="GOG CLI command to execute")
        
        class Config:
            arbitrary_types_allowed = True
        
        @property
        def name(self) -> str:
            return f"gogcli_{self.command}"
        
        @property
        def description(self) -> str:
            config = COMMAND_CONFIGS.get(GOGCommand(self.command))
            if config:
                return config.description
            return f"Execute gogcli command: {self.command}"
        
        def _run(self, **kwargs) -> str:
            """Run the tool."""
            try:
                command = GOGCommand(self.command)
                result = self.wrapper.execute(command, **kwargs)
                
                if result.success:
                    if result.parsed_data:
                        return json.dumps(result.parsed_data, indent=2)
                    return result.stdout
                else:
                    return f"Error: {result.error or result.stderr}"
                    
            except GOGCLIError as e:
                return f"Error: {str(e)}"
            except Exception as e:
                return f"Unexpected error: {str(e)}"
    
    def create_langchain_tools(wrapper: GOGCLIWrapper) -> List[BaseTool]:
        """
        Create a list of LangChain tools for all available commands.
        
        Args:
            wrapper: GOGCLIWrapper instance.
            
        Returns:
            List of LangChain tools.
        """
        tools = []
        
        for cmd in COMMAND_CONFIGS.keys():
            if cmd.value in wrapper.allowed_commands:
                tool = GOGCLILangChainTool(wrapper=wrapper, command=cmd.value)
                tools.append(tool)
        
        return tools
    
    # Structured tool for search
    def create_gog_search_tool(wrapper: GOGCLIWrapper) -> StructuredTool:
        """Create a structured LangChain tool for GOG search."""
        return StructuredTool(
            name="gog_search",
            description="Search for games, software, and DLCs on GOG",
            func=lambda query, page=1, limit=20: json.dumps(
                wrapper.execute(GOGCommand.SEARCH, query=query, page=page, limit=limit).parsed_data or {}
            ),
            args_schema=GOGSearchInput,
        )
    
except ImportError:
    logger.debug("LangChain not installed. LangChain integration unavailable.")


# =============================================================================
# CrewAI Integration
# =============================================================================

try:
    from crewai.tools import BaseTool as CrewAITool
    from crewai.tools import tool as crewai_tool_decorator
    
    class GOGCLICrewAITool(CrewAITool):
        """
        CrewAI tool for GOG CLI operations.
        
        Usage:
            wrapper = GOGCLIWrapper()
            tool = GOGCLICrewAITool(
                name="gog_search",
                description="Search for games on GOG",
                func=lambda query: wrapper.execute(GOGCommand.SEARCH, query=query)
            )
        """
        
        def __init__(
            self,
            name: str,
            description: str,
            wrapper: GOGCLIWrapper,
            command: str,
            **kwargs
        ):
            super().__init__(
                name=name,
                description=description,
                func=self._execute,
                **kwargs
            )
            self.wrapper = wrapper
            self.command = command
        
        def _execute(self, **kwargs) -> str:
            """Execute the GOG CLI command."""
            try:
                command = GOGCommand(self.command)
                result = self.wrapper.execute(command, **kwargs)
                
                if result.success:
                    if result.parsed_data:
                        return json.dumps(result.parsed_data, indent=2)
                    return result.stdout
                else:
                    return f"Error: {result.error or result.stderr}"
                    
            except GOGCLIError as e:
                return f"Error: {str(e)}"
            except Exception as e:
                return f"Unexpected error: {str(e)}"
    
    def create_crewai_tools(wrapper: GOGCLIWrapper) -> List[CrewAITool]:
        """
        Create a list of CrewAI tools for all available commands.
        
        Args:
            wrapper: GOGCLIWrapper instance.
            
        Returns:
            List of CrewAI tools.
        """
        tools = []
        
        for cmd in COMMAND_CONFIGS.keys():
            if cmd.value in wrapper.allowed_commands:
                config = COMMAND_CONFIGS[cmd]
                tool = GOGCLICrewAITool(
                    name=f"gogcli_{config.name}",
                    description=config.description,
                    wrapper=wrapper,
                    command=cmd.value,
                )
                tools.append(tool)
        
        return tools
    
except ImportError:
    logger.debug("CrewAI not installed. CrewAI integration unavailable.")


# =============================================================================
# LlamaIndex Integration
# =============================================================================

try:
    from llama_index.core.tools import FunctionTool
    from llama_index.core.tools import BaseTool as LlamaIndexTool
    
    class GOGCLILlamaIndexTool:
        """
        LlamaIndex tool for GOG CLI operations.
        
        Usage:
            wrapper = GOGCLIWrapper()
            tool = FunctionTool.from_defaults(
                fn=wrapper.execute,
                name="gog_search",
                description="Search for games on GOG"
            )
        """
        
        @staticmethod
        def create_search_tool(wrapper: GOGCLIWrapper) -> FunctionTool:
            """Create a LlamaIndex tool for GOG search."""
            def search_games(query: str, page: int = 1, limit: int = 20) -> str:
                """Search for games, software, and DLCs on GOG."""
                result = wrapper.execute(GOGCommand.SEARCH, query=query, page=page, limit=limit)
                if result.success and result.parsed_data:
                    return json.dumps(result.parsed_data)
                return f"Error: {result.error or result.stderr}"
            
            return FunctionTool.from_defaults(
                fn=search_games,
                name="gog_search",
                description="Search for games, software, and DLCs on GOG",
            )
        
        @staticmethod
        def create_details_tool(wrapper: GOGCLIWrapper) -> FunctionTool:
            """Create a LlamaIndex tool for GOG product details."""
            def get_product_details(product_id: str) -> str:
                """Get detailed information about a specific product."""
                result = wrapper.execute(GOGCommand.DETAILS, product_id=product_id)
                if result.success and result.parsed_data:
                    return json.dumps(result.parsed_data)
                return f"Error: {result.error or result.stderr}"
            
            return FunctionTool.from_defaults(
                fn=get_product_details,
                name="gog_product_details",
                description="Get detailed information about a specific GOG product",
            )
        
        @staticmethod
        def create_library_tool(wrapper: GOGCLIWrapper) -> FunctionTool:
            """Create a LlamaIndex tool for GOG library."""
            def get_library(page: int = 1, limit: int = 50) -> str:
                """List all games in your GOG library."""
                result = wrapper.execute(GOGCommand.LIBRARY, page=page, limit=limit)
                if result.success and result.parsed_data:
                    return json.dumps(result.parsed_data)
                return f"Error: {result.error or result.stderr}"
            
            return FunctionTool.from_defaults(
                fn=get_library,
                name="gog_library",
                description="List all games in your GOG library",
            )
        
        @staticmethod
        def create_all_tools(wrapper: GOGCLIWrapper) -> List[FunctionTool]:
            """Create all available LlamaIndex tools."""
            tools = [
                GOGCLILlamaIndexTool.create_search_tool(wrapper),
                GOGCLILlamaIndexTool.create_details_tool(wrapper),
                GOGCLILlamaIndexTool.create_library_tool(wrapper),
            ]
            
            # Add more tools as needed
            return tools
    
except ImportError:
    logger.debug("LlamaIndex not installed. LlamaIndex integration unavailable.")


# =============================================================================
# Generic Tool Schema (for custom frameworks)
# =============================================================================

@dataclass
class ToolSchema:
    """Generic tool schema for custom agentic frameworks."""
    name: str
    description: str
    parameters: Dict[str, Dict[str, Any]]
    requires_auth: bool
    read_only: bool
    example: Dict[str, Any]


def get_all_tool_schemas() -> List[ToolSchema]:
    """
    Get tool schemas for all available commands.
    
    Returns:
        List of ToolSchema objects.
    """
    schemas = []
    
    for cmd, config in COMMAND_CONFIGS.items():
        # Create example parameters
        example = {}
        for param_name, param_config in config.parameters.items():
            if param_config.get("required", False):
                if param_config["type"] == "string":
                    example[param_name] = "example_value"
                elif param_config["type"] == "integer":
                    example[param_name] = 1
            elif "default" in param_config:
                example[param_name] = param_config["default"]
        
        schemas.append(ToolSchema(
            name=config.name,
            description=config.description,
            parameters=config.parameters,
            requires_auth=config.requires_auth,
            read_only=config.read_only,
            example=example,
        ))
    
    return schemas


# =============================================================================
# Convenience Functions
# =============================================================================

def create_wrapper(
    gogcli_path: Optional[str] = None,
    timeout: int = 60,
    max_retries: int = 3,
    allowed_commands: Optional[List[str]] = None,
) -> GOGCLIWrapper:
    """
    Create a configured GOGCLIWrapper instance.
    
    Args:
        gogcli_path: Path to gogcli executable.
        timeout: Command execution timeout in seconds.
        max_retries: Maximum number of retries.
        allowed_commands: List of allowed commands.
    
    Returns:
        Configured GOGCLIWrapper instance.
    """
    return GOGCLIWrapper(
        gogcli_path=gogcli_path,
        timeout=timeout,
        max_retries=max_retries,
        allowed_commands=allowed_commands,
    )


def search_games(query: str, wrapper: Optional[GOGCLIWrapper] = None, **kwargs) -> Dict[str, Any]:
    """
    Search for games on GOG.
    
    Args:
        query: Search query.
        wrapper: Optional GOGCLIWrapper instance.
        **kwargs: Additional search parameters.
    
    Returns:
        Search results as dictionary.
    """
    if wrapper is None:
        wrapper = create_wrapper()
    
    result = wrapper.execute(GOGCommand.SEARCH, query=query, **kwargs)
    return result.parsed_data or {}


def get_product_details(product_id: str, wrapper: Optional[GOGCLIWrapper] = None) -> Dict[str, Any]:
    """
    Get detailed information about a product.
    
    Args:
        product_id: Product ID or slug.
        wrapper: Optional GOGCLIWrapper instance.
    
    Returns:
        Product details as dictionary.
    """
    if wrapper is None:
        wrapper = create_wrapper()
    
    result = wrapper.execute(GOGCommand.DETAILS, product_id=product_id)
    return result.parsed_data or {}


def get_library(wrapper: Optional[GOGCLIWrapper] = None, **kwargs) -> Dict[str, Any]:
    """
    Get the user's GOG library.
    
    Args:
        wrapper: Optional GOGCLIWrapper instance.
        **kwargs: Additional library parameters.
    
    Returns:
        Library contents as dictionary.
    """
    if wrapper is None:
        wrapper = create_wrapper()
    
    result = wrapper.execute(GOGCommand.LIBRARY, **kwargs)
    return result.parsed_data or {}


# =============================================================================
# Main Entry Point
# =============================================================================

if __name__ == "__main__":
    # Example usage
    print("GOG CLI Wrapper for Agentic Frameworks")
    print("=" * 50)
    
    # Create wrapper
    wrapper = create_wrapper(
        allowed_commands=["search", "details", "categories", "genres", "news"],
        timeout=30,
        max_retries=3,
    )
    
    # Print available commands
    print("\nAvailable commands:")
    for cmd in wrapper.allowed_commands:
        print(f"  - {cmd}")
    
    # Print tool schemas
    print("\nTool schemas:")
    for schema in get_all_tool_schemas():
        print(f"\n  {schema.name}:")
        print(f"    Description: {schema.description}")
        print(f"    Requires Auth: {schema.requires_auth}")
        print(f"    Read Only: {schema.read_only}")
        print(f"    Parameters: {list(schema.parameters.keys())}")
        if schema.example:
            print(f"    Example: {schema.example}")
    
    # Print metrics
    print("\nMetrics:")
    print(json.dumps(wrapper.get_metrics(), indent=2))
