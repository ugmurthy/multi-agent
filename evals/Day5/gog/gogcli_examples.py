"""
Examples for GOG CLI Wrapper

This file demonstrates how to use the GOGCLIWrapper with various agentic frameworks.
"""

import json
from gogcli_wrapper import (
    GOGCLIWrapper,
    GOGCommand,
    create_wrapper,
    search_games,
    get_product_details,
    get_library,
    get_all_tool_schemas,
    ExecutionResult,
)


def basic_usage_example():
    """Basic usage of the GOGCLIWrapper."""
    print("=" * 60)
    print("BASIC USAGE EXAMPLE")
    print("=" * 60)
    
    # Create a wrapper instance
    wrapper = GOGCLIWrapper(
        timeout=30,
        max_retries=3,
        allowed_commands=["search", "details", "categories", "genres", "news"],
    )
    
    # Execute a search command
    print("\n1. Searching for games...")
    result = wrapper.execute(GOGCommand.SEARCH, query="cyberpunk")
    
    if result.success:
        print(f"   ✓ Search completed in {result.execution_time:.2f}s")
        print(f"   ✓ Found data: {result.parsed_data is not None}")
        if result.parsed_data:
            print(f"   Sample result: {json.dumps(result.parsed_data, indent=4)[:500]}...")
    else:
        print(f"   ✗ Error: {result.error}")
    
    # Get product details
    print("\n2. Getting product details...")
    result = wrapper.execute(GOGCommand.DETAILS, product_id="1207658691")
    
    if result.success and result.parsed_data:
        print(f"   ✓ Details retrieved")
        print(f"   Product: {json.dumps(result.parsed_data, indent=4)[:500]}...")
    else:
        print(f"   ✗ Error: {result.error}")
    
    # Get categories
    print("\n3. Getting categories...")
    result = wrapper.execute(GOGCommand.CATEGORIES)
    
    if result.success and result.parsed_data:
        print(f"   ✓ Categories retrieved")
        print(f"   Count: {len(result.parsed_data) if isinstance(result.parsed_data, list) else 'N/A'}")
    
    # Get metrics
    print("\n4. Execution metrics:")
    metrics = wrapper.get_metrics()
    print(json.dumps(metrics, indent=2))


def advanced_usage_example():
    """Advanced usage with custom configuration."""
    print("\n" + "=" * 60)
    print("ADVANCED USAGE EXAMPLE")
    print("=" * 60)
    
    # Create wrapper with custom settings
    wrapper = GOGCLIWrapper(
        gogcli_path="gogcli",  # Custom path if needed
        timeout=60,
        max_retries=5,
        initial_backoff=2.0,
        max_backoff=120.0,
        allowed_commands=["search", "details", "library", "wishlist", "auth_status"],
        enable_logging=True,
    )
    
    # Check authentication status
    print("\n1. Checking authentication status...")
    is_auth = wrapper.is_authenticated()
    print(f"   Authenticated: {is_auth}")
    
    # Manage allowed commands
    print("\n2. Managing allowed commands...")
    print(f"   Initial commands: {wrapper.get_allowed_commands()}")
    
    wrapper.add_allowed_command("news")
    print(f"   After adding 'news': {wrapper.get_allowed_commands()}")
    
    wrapper.remove_allowed_command("news")
    print(f"   After removing 'news': {wrapper.get_allowed_commands()}")
    
    # Execute with error handling
    print("\n3. Executing with error handling...")
    try:
        result = wrapper.execute(
            GOGCommand.SEARCH,
            query="the witcher",
            page=1,
            limit=10
        )
        
        if result.success:
            print(f"   ✓ Success! Retry count: {result.retry_count}")
            print(f"   ✓ Rate limited: {result.rate_limited}")
            print(f"   ✓ Execution time: {result.execution_time:.2f}s")
        else:
            print(f"   ✗ Failed: {result.error}")
            
    except Exception as e:
        print(f"   ✗ Exception: {e}")


def convenience_functions_example():
    """Using convenience functions."""
    print("\n" + "=" * 60)
    print("CONVENIENCE FUNCTIONS EXAMPLE")
    print("=" * 60)
    
    # Search games
    print("\n1. Searching games with convenience function...")
    results = search_games("elden ring")
    if results:
        print(f"   ✓ Found results: {type(results)}")
    
    # Get product details
    print("\n2. Getting product details...")
    details = get_product_details("1207658691")
    if details:
        print(f"   ✓ Got details: {type(details)}")
    
    # Get library (requires authentication)
    print("\n3. Getting library...")
    library = get_library()
    if library:
        print(f"   ✓ Got library: {type(library)}")


def tool_schemas_example():
    """Inspecting tool schemas."""
    print("\n" + "=" * 60)
    print("TOOL SCHEMAS EXAMPLE")
    print("=" * 60)
    
    schemas = get_all_tool_schemas()
    
    print(f"\nTotal schemas available: {len(schemas)}")
    
    for schema in schemas[:5]:  # Show first 5
        print(f"\n{'─' * 50}")
        print(f"Name: {schema.name}")
        print(f"Description: {schema.description}")
        print(f"Requires Auth: {schema.requires_auth}")
        print(f"Read Only: {schema.read_only}")
        print(f"Parameters:")
        for param_name, param_config in schema.parameters.items():
            required = "required" if param_config.get("required") else "optional"
            print(f"  - {param_name}: {param_config['type']} ({required})")
        if schema.example:
            print(f"Example: {schema.example}")


def error_handling_example():
    """Demonstrating error handling."""
    print("\n" + "=" * 60)
    print("ERROR HANDLING EXAMPLE")
    print("=" * 60)
    
    wrapper = create_wrapper()
    
    # Test with invalid command (not in allowlist)
    print("\n1. Testing command not in allowlist...")
    try:
        # Add a custom command that doesn't exist
        wrapper.allowed_commands = ["nonexistent_command"]
        result = wrapper.execute("nonexistent_command")
        print(f"   Result: {result.success}")
    except Exception as e:
        print(f"   ✓ Caught exception: {type(e).__name__}: {e}")
    
    # Reset allowlist
    wrapper.allowed_commands = ["search", "details"]
    
    # Test timeout handling
    print("\n2. Testing timeout handling...")
    wrapper.timeout = 1  # Very short timeout
    try:
        result = wrapper.execute(GOGCommand.SEARCH, query="test")
        print(f"   Result: success={result.success}, error={result.error}")
    except Exception as e:
        print(f"   ✓ Caught exception: {type(e).__name__}: {e}")
    
    # Reset timeout
    wrapper.timeout = 60


def framework_integration_example():
    """Example of framework integration (pseudo-code)."""
    print("\n" + "=" * 60)
    print("FRAMEWORK INTEGRATION EXAMPLE")
    print("=" * 60)
    
    print("\n1. LangChain Integration:")
    print("""
    from langchain.agents import initialize_agent, Tool
    from gogcli_wrapper import create_langchain_tools
    
    wrapper = create_wrapper()
    tools = create_langchain_tools(wrapper)
    
    agent = initialize_agent(
        tools=tools,
        llm=llm,
        agent=AgentType.ZERO_SHOT_REACT_DESCRIPTION,
        verbose=True
    )
    
    agent.run("Search for cyberpunk games on GOG")
    """)
    
    print("\n2. CrewAI Integration:")
    print("""
    from crewai import Agent, Task, Crew
    from gogcli_wrapper import create_crewai_tools
    
    wrapper = create_wrapper()
    tools = create_crewai_tools(wrapper)
    
    researcher = Agent(
        role='GOG Researcher',
        goal='Find games on GOG',
        verbose=True,
        tools=tools
    )
    
    task = Task(
        description='Search for RPG games',
        agent=researcher,
        expected_output='List of RPG games'
    )
    
    crew = Crew(agents=[researcher], tasks=[task])
    result = crew.kickoff()
    """)
    
    print("\n3. LlamaIndex Integration:")
    print("""
    from llama_index.core import AgentWorker
    from llama_index.core.tools import FunctionTool
    from gogcli_wrapper import GOGCLILlamaIndexTool
    
    wrapper = create_wrapper()
    tools = GOGCLILlamaIndexTool.create_all_tools(wrapper)
    
    agent = AgentWorker.from_tools(
        tools,
        llm=llm,
        verbose=True
    )
    
    response = agent.chat("What games are in my library?")
    """)


def custom_tool_example():
    """Creating custom tools with the wrapper."""
    print("\n" + "=" * 60)
    print("CUSTOM TOOL EXAMPLE")
    print("=" * 60)
    
    wrapper = create_wrapper()
    
    # Create a custom search function
    def custom_game_search(query: str, genre: str = None, min_rating: float = None) -> str:
        """
        Custom search function with additional filtering.
        
        Args:
            query: Search query
            genre: Optional genre filter
            min_rating: Optional minimum rating filter
        
        Returns:
            JSON string of results
        """
        result = wrapper.execute(GOGCommand.SEARCH, query=query)
        
        if not result.success:
            return f"Error: {result.error}"
        
        data = result.parsed_data or {}
        
        # Apply custom filtering
        if isinstance(data, list):
            filtered = data
            if genre:
                filtered = [g for g in filtered if genre.lower() in str(g.get('genres', [])).lower()]
            if min_rating:
                filtered = [g for g in filtered if g.get('rating', 0) >= min_rating]
            
            return json.dumps(filtered, indent=2)
        
        return json.dumps(data, indent=2)
    
    # Test the custom function
    print("\n1. Testing custom search function...")
    output = custom_game_search("rpg")
    print(f"   Output length: {len(output)} characters")
    print(f"   First 200 chars: {output[:200]}...")


def main():
    """Run all examples."""
    print("\n" + "╔" + "═" * 58 + "╗")
    print("║" + " " * 15 + "GOG CLI WRAPPER EXAMPLES" + " " * 17 + "║")
    print("╚" + "═" * 58 + "╝")
    
    try:
        basic_usage_example()
        advanced_usage_example()
        convenience_functions_example()
        tool_schemas_example()
        error_handling_example()
        framework_integration_example()
        custom_tool_example()
        
        print("\n" + "=" * 60)
        print("ALL EXAMPLES COMPLETED")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n✗ Error running examples: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
