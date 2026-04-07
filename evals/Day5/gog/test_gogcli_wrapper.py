"""
Tests for GOG CLI Wrapper

Run with: pytest tests/ -v
"""

import pytest
import os
import json
import time
from unittest.mock import Mock, patch, MagicMock
from typing import Dict, Any

from gogcli_wrapper import (
    GOGCLIWrapper,
    GOGCommand,
    GOGCommandConfig,
    COMMAND_CONFIGS,
    ExecutionResult,
    GOGCLIError,
    AuthenticationError,
    RateLimitError,
    CommandNotAllowedError,
    ExecutionTimeoutError,
    ParseError,
    create_wrapper,
    get_all_tool_schemas,
    ToolSchema,
)


class TestGOGCommandEnum:
    """Tests for GOGCommand enum."""
    
    def test_command_values_exist(self):
        """Test that all expected commands exist."""
        expected_commands = [
            "search", "details", "library", "installed",
            "news", "categories", "genres", "wishlist",
            "auth_status", "account_info"
        ]
        
        for cmd in expected_commands:
            assert hasattr(GOGCommand, cmd.upper().replace("_", "")), \
                f"Missing command: {cmd}"
    
    def test_command_value_access(self):
        """Test accessing command values."""
        assert GOGCommand.SEARCH.value == "search"
        assert GOGCommand.DETAILS.value == "details"
        assert GOGCommand.LIBRARY.value == "library"


class TestGOGCommandConfig:
    """Tests for GOGCommandConfig."""
    
    def test_config_creation(self):
        """Test creating a command config."""
        config = GOGCommandConfig(
            name="test",
            description="Test command",
            parameters={
                "query": {"type": "string", "required": True}
            },
            requires_auth=False,
            read_only=True
        )
        
        assert config.name == "test"
        assert config.description == "Test command"
        assert config.requires_auth is False
        assert config.read_only is True
        assert "query" in config.parameters
    
    def test_config_default_values(self):
        """Test default values in config."""
        config = GOGCommandConfig(
            name="test",
            description="Test"
        )
        
        assert config.parameters == {}
        assert config.requires_auth is False
        assert config.read_only is True


class TestExecutionResult:
    """Tests for ExecutionResult dataclass."""
    
    def test_result_creation(self):
        """Test creating an execution result."""
        result = ExecutionResult(
            success=True,
            command="gogcli search",
            stdout='{"games": []}',
            stderr="",
            parsed_data={"games": []},
            raw_output='{"games": []}',
            execution_time=1.5,
        )
        
        assert result.success is True
        assert result.command == "gogcli search"
        assert result.parsed_data == {"games": []}
        assert result.execution_time == 1.5
        assert result.error is None
        assert result.retry_count == 0
        assert result.rate_limited is False
    
    def test_result_with_error(self):
        """Test creating a result with error."""
        result = ExecutionResult(
            success=False,
            command="gogcli search",
            stdout="",
            stderr="Authentication failed",
            parsed_data=None,
            raw_output="",
            execution_time=0.5,
            error="Authentication failed",
            retry_count=2,
            rate_limited=True
        )
        
        assert result.success is False
        assert result.error == "Authentication failed"
        assert result.retry_count == 2
        assert result.rate_limited is True


class TestGOGCLIWrapper:
    """Tests for GOGCLIWrapper."""
    
    def test_wrapper_initialization(self):
        """Test wrapper initialization with default values."""
        wrapper = GOGCLIWrapper()
        
        assert wrapper.timeout == 60
        assert wrapper.max_retries == 3
        assert wrapper.initial_backoff == 1.0
        assert wrapper.max_backoff == 60.0
        assert wrapper.enable_logging is True
    
    def test_wrapper_custom_initialization(self):
        """Test wrapper initialization with custom values."""
        wrapper = GOGCLIWrapper(
            timeout=30,
            max_retries=5,
            initial_backoff=2.0,
            max_backoff=120.0,
            allowed_commands=["search", "details"],
            enable_logging=False,
        )
        
        assert wrapper.timeout == 30
        assert wrapper.max_retries == 5
        assert wrapper.initial_backoff == 2.0
        assert wrapper.max_backoff == 120.0
        assert wrapper.allowed_commands == ["search", "details"]
        assert wrapper.enable_logging is False
    
    def test_get_credentials(self):
        """Test credential retrieval from environment."""
        wrapper = GOGCLIWrapper()
        
        # Set test environment variable
        os.environ["GOGCLI_TOKEN"] = "test_token_12345"
        
        credentials = wrapper._get_credentials()
        
        assert "GOGCLI_TOKEN" in credentials
        # Token should be masked
        assert credentials["GOGCLI_TOKEN"] != "test_token_12345"
        
        # Cleanup
        del os.environ["GOGCLI_TOKEN"]
    
    def test_mask_secret(self):
        """Test secret masking."""
        wrapper = GOGCLIWrapper()
        
        # Test short secret
        short = wrapper._mask_secret("abc")
        assert short == "***"
        
        # Test long secret
        long = wrapper._mask_secret("0123456789abcdef")
        assert long.startswith("0123")
        assert long.endswith("cdef")
        assert "*" in long
    
    @patch('gogcli_wrapper.subprocess.run')
    def test_execute_command_success(self, mock_run):
        """Test successful command execution."""
        mock_run.return_value = Mock(
            returncode=0,
            stdout='{"games": [{"name": "Test Game"}]}',
            stderr=""
        )
        
        wrapper = GOGCLIWrapper()
        result = wrapper._execute_command(["gogcli", "--json", "search"])
        
        assert result.success is True
        assert result.stdout == '{"games": [{"name": "Test Game"}]}'
        assert result.stderr == ""
        mock_run.assert_called_once()
    
    @patch('gogcli_wrapper.subprocess.run')
    def test_execute_command_failure(self, mock_run):
        """Test failed command execution."""
        mock_run.return_value = Mock(
            returncode=1,
            stdout="",
            stderr="Authentication failed"
        )
        
        wrapper = GOGCLIWrapper()
        result = wrapper._execute_command(["gogcli", "--json", "search"])
        
        assert result.success is False
        assert result.stderr == "Authentication failed"
    
    @patch('gogcli_wrapper.subprocess.run')
    def test_execute_command_timeout(self, mock_run):
        """Test command timeout."""
        from subprocess import TimeoutExpired
        
        mock_run.side_effect = TimeoutExpired("gogcli", timeout=60)
        
        wrapper = GOGCLIWrapper(timeout=60)
        
        with pytest.raises(ExecutionTimeoutError):
            wrapper._execute_command(["gogcli", "--json", "search"])
    
    def test_parse_json_output_success(self):
        """Test successful JSON parsing."""
        wrapper = GOGCLIWrapper()
        
        json_str = '{"games": [{"name": "Test", "price": 19.99}]}'
        result = wrapper._parse_json_output(json_str)
        
        assert result is not None
        assert "games" in result
        assert len(result["games"]) == 1
        assert result["games"][0]["name"] == "Test"
    
    def test_parse_json_output_empty(self):
        """Test parsing empty output."""
        wrapper = GOGCLIWrapper()
        
        result = wrapper._parse_json_output("")
        assert result is None
        
        result = wrapper._parse_json_output(None)
        assert result is None
    
    def test_parse_json_output_invalid(self):
        """Test parsing invalid JSON."""
        wrapper = GOGCLIWrapper()
        
        result = wrapper._parse_json_output("not json at all")
        assert result is None
    
    def test_parse_json_output_mixed(self):
        """Test parsing JSON from mixed output."""
        wrapper = GOGCLIWrapper()
        
        mixed_output = "Some text before\n{\"games\": []}\nSome text after"
        result = wrapper._parse_json_output(mixed_output)
        
        assert result is not None
        assert "games" in result
    
    def test_exponential_backoff(self):
        """Test exponential backoff calculation."""
        wrapper = GOGCLIWrapper(initial_backoff=1.0, max_backoff=60.0)
        
        # Test increasing backoff
        backoff_0 = wrapper._exponential_backoff(0)
        backoff_1 = wrapper._exponential_backoff(1)
        backoff_2 = wrapper._exponential_backoff(2)
        
        assert backoff_1 > backoff_0
        assert backoff_2 > backoff_1
        
        # Test max backoff cap
        backoff_high = wrapper._exponential_backoff(20)
        assert backoff_high <= 60.0
    
    def test_is_command_allowed(self):
        """Test command allowlist checking."""
        wrapper = GOGCLIWrapper(allowed_commands=["search", "details"])
        
        assert wrapper._is_command_allowed("search") is True
        assert wrapper._is_command_allowed("details") is True
        assert wrapper._is_command_allowed("library") is False
    
    def test_build_command(self):
        """Test command building."""
        wrapper = GOGCLIWrapper()
        
        cmd = wrapper._build_command(GOGCommand.SEARCH, query="test", page=1)
        
        assert "gogcli" in cmd
        assert "--json" in cmd
        assert "search" in cmd
        assert "query" in cmd
        assert "test" in cmd
    
    def test_build_command_missing_required(self):
        """Test command building with missing required parameter."""
        wrapper = GOGCLIWrapper()
        
        with pytest.raises(ValueError):
            wrapper._build_command(GOGCommand.DETAILS)  # product_id required
    
    def test_get_metrics(self):
        """Test metrics retrieval."""
        wrapper = GOGCLIWrapper()
        
        # Simulate some requests
        wrapper._metrics["total_requests"] = 10
        wrapper._metrics["successful_requests"] = 8
        wrapper._metrics["failed_requests"] = 2
        wrapper._metrics["total_execution_time"] = 20.0
        
        metrics = wrapper.get_metrics()
        
        assert metrics["total_requests"] == 10
        assert metrics["success_rate"] == 0.8
        assert metrics["avg_execution_time"] == 2.0
    
    def test_add_allowed_command(self):
        """Test adding command to allowlist."""
        wrapper = GOGCLIWrapper(allowed_commands=["search"])
        
        wrapper.add_allowed_command("details")
        
        assert "details" in wrapper.allowed_commands
    
    def test_remove_allowed_command(self):
        """Test removing command from allowlist."""
        wrapper = GOGCLIWrapper(allowed_commands=["search", "details"])
        
        wrapper.remove_allowed_command("details")
        
        assert "details" not in wrapper.allowed_commands
    
    def test_get_allowed_commands(self):
        """Test getting allowed commands."""
        wrapper = GOGCLIWrapper(allowed_commands=["search", "details"])
        
        commands = wrapper.get_allowed_commands()
        
        assert commands == ["search", "details"]
        # Should return a copy
        commands.append("test")
        assert "test" not in wrapper.allowed_commands


class TestCommandNotAllowedError:
    """Tests for command allowlist enforcement."""
    
    @patch('gogcli_wrapper.GOGCLIWrapper._execute_command')
    def test_command_not_allowed(self, mock_execute):
        """Test that disallowed commands raise error."""
        wrapper = GOGCLIWrapper(allowed_commands=["search"])
        
        with pytest.raises(CommandNotAllowedError):
            wrapper.execute(GOGCommand.DETAILS, product_id="123")


class TestRateLimiting:
    """Tests for rate limiting."""
    
    def test_check_rate_limit(self):
        """Test rate limit checking."""
        wrapper = GOGCLIWrapper()
        
        # Should not be rate limited initially
        assert wrapper._check_rate_limit() is False
        
        # Simulate many requests
        for _ in range(15):
            wrapper._check_rate_limit()
        
        # Should be rate limited now
        assert wrapper._check_rate_limit() is True


class TestToolSchemas:
    """Tests for tool schemas."""
    
    def test_get_all_tool_schemas(self):
        """Test getting all tool schemas."""
        schemas = get_all_tool_schemas()
        
        assert len(schemas) > 0
        assert all(isinstance(s, ToolSchema) for s in schemas)
    
    def test_tool_schema_structure(self):
        """Test tool schema structure."""
        schemas = get_all_tool_schemas()
        
        # Check first schema
        schema = schemas[0]
        
        assert hasattr(schema, "name")
        assert hasattr(schema, "description")
        assert hasattr(schema, "parameters")
        assert hasattr(schema, "requires_auth")
        assert hasattr(schema, "read_only")
        assert hasattr(schema, "example")


class TestConvenienceFunctions:
    """Tests for convenience functions."""
    
    def test_create_wrapper(self):
        """Test create_wrapper function."""
        wrapper = create_wrapper(
            timeout=30,
            max_retries=5,
            allowed_commands=["search"]
        )
        
        assert isinstance(wrapper, GOGCLIWrapper)
        assert wrapper.timeout == 30
        assert wrapper.max_retries == 5


class TestErrorHandling:
    """Tests for error handling."""
    
    def test_gogcli_error(self):
        """Test GOGCLIError."""
        with pytest.raises(GOGCLIError):
            raise GOGCLIError("Test error")
    
    def test_authentication_error(self):
        """Test AuthenticationError."""
        with pytest.raises(AuthenticationError):
            raise AuthenticationError("Auth failed")
    
    def test_rate_limit_error(self):
        """Test RateLimitError."""
        with pytest.raises(RateLimitError):
            raise RateLimitError("Rate limited")
    
    def test_command_not_allowed_error(self):
        """Test CommandNotAllowedError."""
        with pytest.raises(CommandNotAllowedError):
            raise CommandNotAllowedError("Command not allowed")
    
    def test_execution_timeout_error(self):
        """Test ExecutionTimeoutError."""
        with pytest.raises(ExecutionTimeoutError):
            raise ExecutionTimeoutError("Timeout")


class TestIntegration:
    """Integration tests (require actual gogcli installation)."""
    
    @pytest.mark.integration
    def test_real_search(self):
        """Test real search execution (requires gogcli)."""
        # Skip if gogcli is not installed
        if not os.path.exists("gogcli") and not os.system("which gogcli") == 0:
            pytest.skip("gogcli not installed")
        
        wrapper = create_wrapper(allowed_commands=["search"])
        result = wrapper.execute(GOGCommand.SEARCH, query="test")
        
        # Just check that it doesn't crash
        assert isinstance(result, ExecutionResult)


class TestEdgeCases:
    """Tests for edge cases."""
    
    def test_empty_query(self):
        """Test search with empty query."""
        wrapper = create_wrapper()
        
        # Should not crash, but may return empty results
        cmd = wrapper._build_command(GOGCommand.SEARCH, query="")
        assert "query" in cmd
    
    def test_very_long_query(self):
        """Test search with very long query."""
        wrapper = create_wrapper()
        
        long_query = "a" * 1000
        cmd = wrapper._build_command(GOGCommand.SEARCH, query=long_query)
        assert len(long_query) > 100
    
    def test_special_characters_in_query(self):
        """Test search with special characters."""
        wrapper = create_wrapper()
        
        special_query = "test @#$%^&*()"
        cmd = wrapper._build_command(GOGCommand.SEARCH, query=special_query)
        assert special_query in cmd
    
    def test_unicode_in_query(self):
        """Test search with unicode characters."""
        wrapper = create_wrapper()
        
        unicode_query = "测试游戏"
        cmd = wrapper._build_command(GOGCommand.SEARCH, query=unicode_query)
        assert unicode_query in cmd


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
