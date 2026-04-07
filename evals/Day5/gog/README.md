# GOG CLI Wrapper for Agentic Frameworks

A production-ready Python wrapper for `gogcli` that integrates seamlessly with LangChain, CrewAI, LlamaIndex, and other agentic frameworks.

## Features

- ✅ **Subprocess Execution**: Safe execution with timeout and error handling
- ✅ **JSON Output Parsing**: Automatic parsing with fallback strategies
- ✅ **Rate Limit Handling**: Exponential backoff with jitter
- ✅ **Credential Management**: Secure environment variable handling
- ✅ **Tool Schemas**: Pre-built schemas for LangChain, CrewAI, and LlamaIndex
- ✅ **Command Allowlist**: Security-focused command whitelisting
- ✅ **Logging & Observability**: Comprehensive logging and metrics tracking

## Installation

```bash
# Install gogcli first (platform-specific)
# See: https://github.com/gogcom/gogcli

# Install the wrapper (no pip package yet, just copy the files)
cp gogcli_wrapper.py your_project/
cp gogcli_examples.py your_project/
```

## Quick Start

```python
from gogcli_wrapper import GOGCLIWrapper, GOGCommand

# Create wrapper instance
wrapper = GOGCLIWrapper(
    timeout=30,
    max_retries=3,
    allowed_commands=["search", "details", "categories"]
)

# Execute a search
result = wrapper.execute(GOGCommand.SEARCH, query="cyberpunk")

if result.success and result.parsed_data:
    print(json.dumps(result.parsed_data, indent=2))
```

## Configuration

### Environment Variables

The wrapper supports the following environment variables for authentication:

- `GOGCLI_TOKEN` - GOG CLI authentication token
- `GOGCLI_ACCESS_TOKEN` - Alternative access token
- `GOGCLI_USERNAME` - GOG username
- `GOGCLI_PASSWORD` - GOG password (use with caution)
- `GOGCLI_HOME` - Custom GOG CLI home directory
- `GOGCLI_CONFIG` - Custom config path

### Wrapper Configuration

```python
wrapper = GOGCLIWrapper(
    gogcli_path="gogcli",           # Path to gogcli executable
    timeout=60,                     # Command timeout in seconds
    max_retries=3,                  # Maximum retry attempts
    initial_backoff=1.0,            # Initial backoff for rate limiting
    max_backoff=60.0,               # Maximum backoff time
    allowed_commands=["search"],    # Whitelist of allowed commands
    enable_logging=True,            # Enable logging
    log_level=logging.INFO,         # Logging level
)
```

## Available Commands

| Command | Description | Requires Auth | Read-Only |
|---------|-------------|---------------|-----------|
| `search` | Search for games, software, DLCs | No | Yes |
| `details` | Get product details | No | Yes |
| `library` | List library games | Yes | Yes |
| `installed` | List installed games | No | Yes |
| `news` | Get latest news | No | Yes |
| `categories` | List categories | No | Yes |
| `genres` | List genres | No | Yes |
| `wishlist` | List wishlist items | Yes | Yes |
| `auth_status` | Check auth status | No | Yes |
| `account_info` | Get account info | Yes | Yes |

## Framework Integrations

### LangChain

```python
from langchain.agents import initialize_agent, Tool
from gogcli_wrapper import create_wrapper, create_langchain_tools

# Create wrapper and tools
wrapper = create_wrapper()
tools = create_langchain_tools(wrapper)

# Create agent
agent = initialize_agent(
    tools=tools,
    llm=llm,
    agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
    verbose=True
)

# Use the agent
agent.run("Search for cyberpunk games on GOG")
```

### CrewAI

```python
from crewai import Agent, Task, Crew
from gogcli_wrapper import create_wrapper, create_crewai_tools

# Create wrapper and tools
wrapper = create_wrapper()
tools = create_crewai_tools(wrapper)

# Create agent
researcher = Agent(
    role='GOG Researcher',
    goal='Find games on GOG',
    verbose=True,
    tools=tools
)

# Create task
task = Task(
    description='Search for RPG games',
    agent=researcher,
    expected_output='List of RPG games'
)

# Run crew
crew = Crew(agents=[researcher], tasks=[task])
result = crew.kickoff()
```

### LlamaIndex

```python
from llama_index.core import AgentWorker
from gogcli_wrapper import create_wrapper, GOGCLILlamaIndexTool

# Create wrapper and tools
wrapper = create_wrapper()
tools = GOGCLILlamaIndexTool.create_all_tools(wrapper)

# Create agent
agent = AgentWorker.from_tools(
    tools,
    llm=llm,
    verbose=True
)

# Query
response = agent.chat("What games are in my library?")
```

## Error Handling

The wrapper provides comprehensive error handling:

```python
from gogcli_wrapper import (
    GOGCLIWrapper,
    GOGCLIError,
    AuthenticationError,
    RateLimitError,
    CommandNotAllowedError,
    ExecutionTimeoutError,
    ParseError
)

wrapper = GOGCLIWrapper()

try:
    result = wrapper.execute(GOGCommand.SEARCH, query="test")
    
    if not result.success:
        print(f"Execution failed: {result.error}")
        
except CommandNotAllowedError as e:
    print(f"Command not allowed: {e}")
except AuthenticationError as e:
    print(f"Authentication failed: {e}")
except RateLimitError as e:
    print(f"Rate limit exceeded: {e}")
except ExecutionTimeoutError as e:
    print(f"Command timed out: {e}")
except GOGCLIError as e:
    print(f"GOG CLI error: {e}")
```

## Execution Result

The `execute()` method returns an `ExecutionResult` object:

```python
@dataclass
class ExecutionResult:
    success: bool              # Whether execution succeeded
    command: str               # Executed command
    stdout: str                # Standard output
    stderr: str                # Standard error
    parsed_data: Optional[Dict]  # Parsed JSON data
    raw_output: str            # Raw output string
    execution_time: float      # Execution time in seconds
    error: Optional[str]       # Error message if failed
    retry_count: int           # Number of retries
    rate_limited: bool         # Whether rate limited
```

## Metrics

Track wrapper performance with built-in metrics:

```python
wrapper = GOGCLIWrapper()

# Execute some commands...
wrapper.execute(GOGCommand.SEARCH, query="test")

# Get metrics
metrics = wrapper.get_metrics()
print(metrics)
# {
#     "total_requests": 10,
#     "successful_requests": 9,
#     "failed_requests": 1,
#     "rate_limited_requests": 0,
#     "total_retries": 2,
#     "total_execution_time": 15.5,
#     "success_rate": 0.9,
#     "avg_execution_time": 1.55
# }
```

## Advanced Usage

### Custom Command Configuration

```python
from gogcli_wrapper import GOGCommand, GOGCommandConfig, COMMAND_CONFIGS

# Add a custom command configuration
custom_config = GOGCommandConfig(
    name="custom_search",
    description="Custom search with filters",
    parameters={
        "query": {"type": "string", "description": "Search query", "required": True},
        "genre": {"type": "string", "description": "Genre filter", "required": False},
    },
    requires_auth=False,
    read_only=True
)

COMMAND_CONFIGS[GOGCommand.SEARCH] = custom_config
```

### Custom Tool Creation

```python
from gogcli_wrapper import create_wrapper

wrapper = create_wrapper()

def custom_search(query: str, min_rating: float = 4.0) -> str:
    """Custom search with rating filter."""
    result = wrapper.execute(GOGCommand.SEARCH, query=query)
    
    if result.success and result.parsed_data:
        # Apply custom filtering
        games = result.parsed_data.get('games', [])
        filtered = [g for g in games if g.get('rating', 0) >= min_rating]
        return json.dumps(filtered)
    
    return f"Error: {result.error}"
```

### Rate Limiting Control

```python
wrapper = GOGCLIWrapper(
    max_retries=5,
    initial_backoff=2.0,
    max_backoff=120.0,
)

# The wrapper will automatically:
# 1. Track requests per second
# 2. Apply exponential backoff when rate limited
# 3. Add jitter to prevent thundering herd
```

## Security Best Practices

1. **Use Command Allowlists**: Only enable commands you need
2. **Environment Variables**: Store credentials in environment variables, not code
3. **Read-Only Mode**: Use read-only commands when possible
4. **Timeout Settings**: Set appropriate timeouts to prevent hanging
5. **Logging**: Enable logging for audit trails

```python
# Secure configuration
wrapper = GOGCLIWrapper(
    allowed_commands=["search", "details", "categories"],  # Minimal set
    timeout=30,                                             # Reasonable timeout
    enable_logging=True,                                    # Enable audit logs
    log_level=logging.INFO,                                 # Appropriate level
)
```

## Logging

The wrapper provides comprehensive logging:

```python
import logging
from gogcli_wrapper import GOGCLIWrapper

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

wrapper = GOGCLIWrapper(enable_logging=True, log_level=logging.DEBUG)

# Logs will include:
# - Command execution
# - Rate limiting events
# - Retry attempts
# - Errors and exceptions
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Troubleshooting

### gogcli not found

Ensure gogcli is installed and in your PATH:

```bash
which gogcli  # Should show the path
gogcli --version  # Should show version
```

If not in PATH, specify the path explicitly:

```python
wrapper = GOGCLIWrapper(gogcli_path="/path/to/gogcli")
```

### Authentication Errors

Check your credentials:

```bash
# Verify environment variables
echo $GOGCLI_TOKEN

# Or check auth status
wrapper.is_authenticated()
```

### Rate Limiting

If you're hitting rate limits:

```python
wrapper = GOGCLIWrapper(
    max_retries=5,
    initial_backoff=2.0,
    max_backoff=120.0,
)
```

### Timeout Errors

Increase the timeout for slow operations:

```python
wrapper = GOGCLIWrapper(timeout=120)  # 2 minutes
```

## Examples

See `gogcli_examples.py` for comprehensive usage examples covering:

- Basic usage
- Advanced configuration
- Convenience functions
- Tool schemas
- Error handling
- Framework integrations
- Custom tool creation

Run the examples:

```bash
python gogcli_examples.py
```
