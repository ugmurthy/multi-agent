# GOG CLI Wrapper - Quick Reference

## Installation

```bash
# Copy the wrapper files to your project
cp gogcli_wrapper.py your_project/
cp gogcli_examples.py your_project/
```

## Basic Usage

```python
from gogcli_wrapper import GOGCLIWrapper, GOGCommand

# Create wrapper
wrapper = GOGCLIWrapper()

# Search for games
result = wrapper.execute(GOGCommand.SEARCH, query="cyberpunk")
print(result.parsed_data)

# Get product details
result = wrapper.execute(GOGCommand.DETAILS, product_id="1207658691")
print(result.parsed_data)
```

## Available Commands

| Command | Description | Auth Required |
|---------|-------------|---------------|
| `search` | Search games | No |
| `details` | Product details | No |
| `library` | User library | Yes |
| `installed` | Installed games | No |
| `news` | Latest news | No |
| `categories` | All categories | No |
| `genres` | All genres | No |
| `wishlist` | User wishlist | Yes |
| `auth_status` | Check auth | No |
| `account_info` | Account info | Yes |

## Framework Integrations

### LangChain

```python
from gogcli_wrapper import create_wrapper, create_langchain_tools

wrapper = create_wrapper()
tools = create_langchain_tools(wrapper)

# Use with LangChain agent
agent = initialize_agent(tools=tools, llm=llm, ...)
```

### CrewAI

```python
from gogcli_wrapper import create_wrapper, create_crewai_tools

wrapper = create_wrapper()
tools = create_crewai_tools(wrapper)

# Use with CrewAI agent
agent = Agent(role="Researcher", tools=tools, ...)
```

### LlamaIndex

```python
from gogcli_wrapper import create_wrapper, GOGCLILlamaIndexTool

wrapper = create_wrapper()
tools = GOGCLILlamaIndexTool.create_all_tools(wrapper)

# Use with LlamaIndex agent
agent = AgentWorker.from_tools(tools, llm=llm)
```

## Configuration

```python
wrapper = GOGCLIWrapper(
    gogcli_path="gogcli",           # Path to executable
    timeout=60,                     # Timeout in seconds
    max_retries=3,                  # Max retry attempts
    initial_backoff=1.0,            # Initial backoff (seconds)
    max_backoff=60.0,               # Max backoff (seconds)
    allowed_commands=["search"],    # Command whitelist
    enable_logging=True,            # Enable logging
)
```

## Environment Variables

- `GOGCLI_TOKEN` - Authentication token
- `GOGCLI_ACCESS_TOKEN` - Alternative access token
- `GOGCLI_USERNAME` - GOG username
- `GOGCLI_PASSWORD` - GOG password
- `GOGCLI_HOME` - Custom home directory
- `GOGCLI_CONFIG` - Custom config path

## Error Handling

```python
from gogcli_wrapper import (
    GOGCLIError,
    AuthenticationError,
    RateLimitError,
    CommandNotAllowedError,
    ExecutionTimeoutError,
)

try:
    result = wrapper.execute(GOGCommand.SEARCH, query="test")
    if not result.success:
        print(f"Error: {result.error}")
except GOGCLIError as e:
    print(f"GOG CLI Error: {e}")
```

## Execution Result

```python
result = wrapper.execute(GOGCommand.SEARCH, query="test")

# Access result properties
print(result.success)        # bool
print(result.command)        # str
print(result.stdout)         # str
print(result.stderr)         # str
print(result.parsed_data)    # dict or None
print(result.execution_time) # float
print(result.error)          # str or None
print(result.retry_count)    # int
print(result.rate_limited)   # bool
```

## Metrics

```python
metrics = wrapper.get_metrics()
print(metrics)
# {
#     "total_requests": 10,
#     "successful_requests": 9,
#     "failed_requests": 1,
#     "success_rate": 0.9,
#     "avg_execution_time": 1.55
# }
```

## Convenience Functions

```python
from gogcli_wrapper import search_games, get_product_details, get_library

# Search games
results = search_games("elden ring")

# Get product details
details = get_product_details("1207658691")

# Get library (requires auth)
library = get_library()
```

## Custom Tools

```python
from gogcli_wrapper import create_wrapper

wrapper = create_wrapper()

def custom_search(query: str, min_rating: float = 4.0) -> str:
    """Custom search with rating filter."""
    result = wrapper.execute(GOGCommand.SEARCH, query=query)
    if result.success and result.parsed_data:
        games = result.parsed_data.get('games', [])
        filtered = [g for g in games if g.get('rating', 0) >= min_rating]
        return json.dumps(filtered)
    return f"Error: {result.error}"
```

## Security Best Practices

1. **Use command allowlists** - Only enable needed commands
2. **Environment variables** - Store credentials securely
3. **Read-only mode** - Use read-only commands when possible
4. **Timeout settings** - Prevent hanging operations
5. **Enable logging** - Audit trails for debugging

```python
wrapper = GOGCLIWrapper(
    allowed_commands=["search", "details"],  # Minimal set
    timeout=30,                               # Reasonable timeout
    enable_logging=True,                      # Enable audit logs
)
```

## Logging

```python
import logging
from gogcli_wrapper import GOGCLIWrapper

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

wrapper = GOGCLIWrapper(enable_logging=True, log_level=logging.DEBUG)
```

## Troubleshooting

### gogcli not found
```python
wrapper = GOGCLIWrapper(gogcli_path="/path/to/gogcli")
```

### Authentication errors
```bash
echo $GOGCLI_TOKEN  # Verify token
```

### Rate limiting
```python
wrapper = GOGCLIWrapper(
    max_retries=5,
    initial_backoff=2.0,
    max_backoff=120.0,
)
```

### Timeout errors
```python
wrapper = GOGCLIWrapper(timeout=120)  # 2 minutes
```

## Testing

```bash
# Run tests
pytest test_gogcli_wrapper.py -v

# Run examples
python gogcli_examples.py
```

## Files

- `gogcli_wrapper.py` - Main wrapper implementation
- `gogcli_examples.py` - Usage examples
- `gogcli_wrapper.pyi` - Type stubs
- `test_gogcli_wrapper.py` - Test suite
- `README.md` - Full documentation
- `QUICK_REFERENCE.md` - This file
- `pyproject.toml` - Package configuration
- `requirements.txt` - Dependencies
