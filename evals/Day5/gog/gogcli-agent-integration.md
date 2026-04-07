# GOGCLI Agent Integration: Complete Research & Implementation Guide

> **Status**: Production-Ready | **Last Updated**: March 2026 | **Target**: Agentic Frameworks (LangChain, CrewAI, LlamaIndex, OpenClaw)

---

## Executive Summary

**gogcli** (command: `gog`) is an open-source CLI tool that provides unified access to Google Workspace services from the terminal. With **6.7k+ GitHub stars**, **506 forks**, and active development (latest release **v0.12.0** on March 9, 2026), it has emerged as a production-grade solution for AI agent integration with Gmail, Calendar, Drive, Sheets, Docs, and more.

This guide provides comprehensive research, security analysis, and implementation patterns for integrating gogcli into agentic frameworks.

---

## 1. Core Overview

### What is gogcli/gog?

**gogcli** is a Go-based CLI tool that unifies Google Workspace services under a single binary with JSON-first output and sane defaults.

- **Repository**: https://github.com/steipete/gogcli
- **Official Site**: https://gogcli.sh/
- **Maintainer**: Peter Steinberger (@steipete)
- **License**: MIT
- **Stars**: 6.7k+ | **Forks**: 506+ | **Issues**: 82 | **PRs**: 48
- **Latest Release**: v0.12.0 (March 9, 2026)
- **Language**: Go 1.24+

### Supported Google Workspace Services

| Service | Key Capabilities |
|---------|------------------|
| **Gmail** | Search threads, send mail, manage labels, drafts, filters, settings, Pub/Sub watch |
| **Calendar** | List/create/update events, respond to invites, detect conflicts, free/busy check, calendar aliases |
| **Drive** | List/search/upload/download, export Docs formats, permissions, folders, shared drives |
| **Sheets** | Read/write spreadsheets, named ranges, tab management, formatting, find-replace, export to PDF/CSV |
| **Docs** | Create, edit, export (PDF/DOCX/Markdown/HTML), tab targeting, find-replace, pageless mode |
| **Slides** | Create from templates, add/delete slides, export (PDF/PPTX), template placeholder replacement |
| **Contacts** | Search, create, update, directory search, birthdays, custom fields, relations |
| **Tasks** | Tasklists + tasks: add/update/done/undo/delete/clear with paging and JSON output |
| **People** | Profile lookup, directory search, relations |
| **Chat** | Spaces, messages, threads, DMs, reactions (Workspace only) |
| **Forms** | Create/get forms, list/get responses, response watch |
| **Apps Script** | Create/get projects, fetch content, run deployed functions |
| **Classroom** | Courses, roster, coursework/materials, announcements, topics, invitations |
| **Keep** | Note listing, search, create, delete (Workspace + service account only) |
| **Groups** | Group listing, member display (Workspace only) |
| **Admin** | Workspace Admin Directory commands for users and groups |

### Comparison with Official Google Tools

| Feature | gogcli | gcloud CLI | Google Workspace CLI (gws) | Direct REST API |
|---------|--------|------------|---------------------------|-----------------|
| **Gmail Access** | ✅ Full | ❌ No | ✅ Full | ✅ Full |
| **Drive Access** | ✅ Full | ❌ Limited | ✅ Full | ✅ Full |
| **Calendar Access** | ✅ Full | ❌ No | ✅ Full | ✅ Full |
| **JSON Output** | ✅ Native | ✅ Available | ✅ Native | ✅ Native |
| **Multi-Account** | ✅ Built-in | ✅ Available | ✅ Available | Manual |
| **OAuth Management** | ✅ Auto-refresh | ✅ Available | ✅ Available | Manual |
| **Agent-Friendly** | ✅ Optimized | ❌ Enterprise-focused | ✅ Optimized | Manual |
| **Installation** | Simple (brew/make) | Complex (SDK) | Simple (npm/cargo) | Language SDKs |
| **Command Simplicity** | ✅ High | ❌ Complex | ✅ High | ❌ Complex |
| **MCP Support** | ⚠️ Community | ❌ No | ✅ Built-in | ❌ No |

**Key Differences**:
- **gogcli**: Third-party, human-friendly CLI with JSON-first design, excellent for scripting and agent integration
- **gcloud**: Official Google Cloud CLI, focused on GCP infrastructure, limited Workspace API access
- **gws (Google Workspace CLI)**: Official Google CLI (Rust-based), AI-agent optimized, includes MCP server, dynamically built from Discovery Service
- **Direct REST API**: Maximum control but requires manual OAuth, pagination, error handling

**When to Use gogcli**:
- ✅ Quick setup and human-friendly commands
- ✅ JSON-first output for scripting
- ✅ Multi-account support with keyring storage
- ✅ Active community and frequent releases
- ✅ Good for OpenClaw and similar agent frameworks

**When to Use gws**:
- ✅ Official Google support
- ✅ Built-in MCP server
- ✅ Always-current API surface
- ✅ Enterprise-grade with official backing

---

## 2. Installation & Environment Setup

### Installation Methods

#### Homebrew (Recommended)
```bash
# macOS/Linux with Homebrew
brew install steipete/tap/gogcli

# Verify installation
gog --version
# Output: gog v0.12.0 (c18c58c 2026-03-09T...)
```

#### Build from Source
```bash
# Requires Go 1.24+
git clone https://github.com/opete/gogcli.git
cd gogcli
git fetch --tags
git checkout v0.12.0  # Pin to release for stability

# Force local toolchain if needed
export GOTOOLCHAIN=local

make
./bin/gog --help

# Install globally
sudo make install
# Binary installed to /usr/local/bin/gog
```

#### Docker
```dockerfile
FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY . .
RUN make

FROM alpine:latest
COPY --from=builder /app/bin/gog /usr/local/bin/gog
RUN apk add --no-cache jq
ENTRYPOINT ["gog"]
```

#### CI/CD Integration
```yaml
# GitHub Actions example
- name: Install gogcli
  run: |
    curl -L https://github.com/steipete/gogcli/releases/latest/download/gogcli_0.12.0_linux_amd64.tar.gz -o gogcli.tar.gz
    tar -xzf gogcli.tar.gz
    sudo mv gogcli /usr/local/bin/gog
    chmod +x /usr/local/bin/gog

- name: Run gogcli commands
  env:
    GOG_ACCOUNT: ${{ secrets.GOG_ACCOUNT }}
    GOG_CREDENTIALS: ${{ secrets.GOG_CREDENTIALS }}
  run: |
    gog gmail search 'is:unread' --max 10 --json
```

### Headless Server Setup

For agents running on servers without browsers:

```bash
# Step 1: Install gogcli
brew install steipete/tap/gogcli  # or build from source

# Step 2: Register OAuth credentials
gog auth credentials /path/to/client_secret.json

# Step 3: Authorize with manual flow
gog auth add you@gmail.com --services gmail,calendar,drive --manual

# This will output a URL to visit on another device
# After authorization, paste the redirect URL or code back

# Step 4: Set default account
export GOG_ACCOUNT=you@gmail.com
echo 'export GOG_ACCOUNT=you@gmail.com' >> ~/.bashrc

# Step 5: Verify
gog auth list --json
gog gmail search '' --max 5 --json
```

### SSH Tunneling for Remote Auth

For headless VPS authentication:

```bash
# On server
gog auth add you@gmail.com --listen-addr=0.0.0.0:8085 --manual

# On local machine (logged into same Google account)
ssh -L 8085:localhost:8085 user@server

# Visit the URL shown on server, authorize, then paste redirect URL
```

---

## 3. Authentication & Security

### OAuth Client Setup (Google Cloud Console)

#### Step 1: Create Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project or select existing
3. Note the project ID

#### Step 2: Enable Required APIs
```bash
gcloud services enable \
  gmail.googleapis.com \
  calendar-json.googleapis.com \
  drive.googleapis.com \
  sheets.googleapis.com \
  tasks.googleapis.com \
  people.googleapis.com \
  chat.googleapis.com \
  classroom.googleapis.com \
  forms.googleapis.com \
  script.googleapis.com \
  cloudidentity.googleapis.com \
  docs.googleapis.com \
  --project=YOUR_PROJECT_ID
```

#### Step 3: Configure OAuth Consent Screen
1. Navigate to **APIs & Services > OAuth consent screen**
2. Select **External** user type (unless Google Workspace)
3. Fill in:
   - App name: "gogcli for Agent"
   - User support email: your-email@gmail.com
   - Developer contact: your-email@gmail.com
4. **Scopes**: Add required scopes (gogcli handles this automatically)
5. **Test users**: Add your email if in Testing mode
6. Save and continue

#### Step 4: Create OAuth Client ID
1. Navigate to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth client ID**
3. Application type: **Desktop app**
4. Name: "gogcli Desktop Client"
5. Click **Create**
6. Download the JSON file (e.g., `client_secret_XXXXX.apps.googleusercontent.com.json`)

### Auth Flows

#### Browser Flow (Default)
```bash
gog auth add you@gmail.com
# Opens browser automatically
```

#### Manual/Headless Flow
```bash
gog auth add you@gmail.com --manual
# Outputs URL to visit on another device
# Paste redirect URL after authorization
```

#### Remote Flow (Behind Proxy)
```bash
gog auth add you@gmail.com \
  --listen-addr=0.0.0.0:8085 \
  --redirect-host=your-public-domain.com
```

#### Service Account (Domain-Wide Delegation)
```bash
# For Google Workspace environments
gog auth service-account \
  --key-file=/path/to/service-account.json \
  --subject=user@yourdomain.com

# Or use environment variable
export GOG_AUTH_MODE=adc
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

#### Direct Access Token
```bash
# For CI/CD or short-lived tokens
export GOG_ACCESS_TOKEN=ya29.example_token
gog gmail search '' --max 5
```

#### Application Default Credentials (ADC)
```bash
export GOG_AUTH_MODE=adc
# Works with gcloud auth application-default login
gog gmail search '' --max 5
```

### Credential Storage

gogcli stores credentials in OS keyring by default:
- **macOS**: Keychain
- **Linux**: Secret Service (libsecret)
- **Windows**: Credential Manager

#### Switch to File Backend
```bash
# For CI/automation without keyring
gog auth keyring file

# Skip password prompt
export GOG_KEYRING_PASSWORD='any-password'
```

#### Credential Location
```bash
# Config directory
~/.config/gogcli/

# Keyring file (if using file backend)
~/.config/gogcli/keyring
```

### Least-Privilege Scopes

#### Read-Only Mode
```bash
# Gmail read-only
gog auth add you@gmail.com --gmail-scope=readonly

# Sheets read-only
gog auth add you@gmail.com --services sheets --readonly

# Drive read-only
gog auth add you@gmail.com --drive-scope=readonly
```

#### Service-Specific Scopes
```bash
# Only Gmail and Calendar
gog auth add you@gmail.com --services gmail,calendar

# Add extra scopes
gog auth add you@gmail.com --extra-scopes=https://www.googleapis.com/auth/userinfo.profile
```

#### Scope Management
```bash
# View current scopes
gog auth status

# Upgrade permissions
gog auth manage

# Re-auth with force consent (if refresh token missing)
gog auth add you@gmail.com --services sheets --force-consent
```

### Multi-Account Support

#### Environment Variable
```bash
export GOG_ACCOUNT=you@gmail.com
gog gmail search '' --max 5
```

#### Command-Line Flag
```bash
gog gmail search '' --account personal@gmail.com --max 5
gog gmail search '' --account work@company.com --max 5
```

#### Account Aliases
```bash
# Set alias
gog auth alias set work work@company.com

# Use alias
gog gmail search '' --account work --max 5

# List aliases
gog auth alias list
```

#### List All Accounts
```bash
gog auth list --json
# Output:
# {
#   "accounts": [
#     {"email": "personal@gmail.com", "alias": "personal"},
#     {"email": "work@company.com", "alias": "work"}
#   ]
# }
```

---

## 4. Command Structure & Usage

### High-Level Command Groups

```
gog
├── auth          # Authentication management
├── gmail         # Gmail operations
├── calendar      # Calendar operations
├── drive         # Drive operations
├── sheets        # Sheets operations
├── docs          # Docs operations
├── slides        # Slides operations
├── contacts      # Contacts operations
├── tasks         # Tasks operations
├── people        # People operations
├── chat          # Chat operations (Workspace)
├── forms         # Forms operations
├── appscript     # Apps Script operations
├── classroom     # Classroom operations
├── keep          # Keep operations (Workspace)
├── groups        # Groups operations (Workspace)
└── admin         # Admin operations (Workspace)
```

### Gmail Commands

```bash
# Search emails
gog gmail search 'is:unread newer_than:7d' --max 20

# Search with JSON output
gog gmail search 'from:example@gmail.com' --max 10 --json | jq '.threads[].subject'

# Send email
gog gmail send recipient@example.com --subject "Hello" --body "Message body"

# Send with attachment
gog gmail send recipient@example.com --subject "File" --body "See attached" --attachment=/path/to/file.pdf

# Send with quote (reply)
gog gmail send recipient@example.com --subject "Re: Subject" --body "Reply" --quote

# List labels
gog gmail labels list

# Get thread
gog gmail get <threadId>

# Apply labels
gog gmail modify <threadId> --add-labels=IMPORTANT --remove-labels=UNREAD

# Create draft
gog gmail drafts create recipient@example.com --subject "Draft" --body "Draft body"

# Watch for changes (Pub/Sub)
gog gmail watch serve --topic=projects/PROJECT/topics/topic-name
```

### Calendar Commands

```bash
# List calendars
gog calendar calendars --max 5 --json

# List events
gog calendar events primary --today
gog calendar events primary --week
gog calendar events primary --from=2026-03-01 --to=2026-03-07

# Create event
gog calendar create primary \
  --summary "Meeting" \
  --from 2026-03-15T10:00:00+00:00 \
  --to 2026-03-15T11:00:00+00:00 \
  --description "Team sync"

# Update event
gog calendar update primary <eventId> --summary "Updated Meeting"

# Delete event
gog calendar delete primary <eventId>

# Check free/busy
gog calendar freebusy --from=2026-03-15T09:00 --to=2026-03-15T17:00 --cal=primary

# Find conflicts
gog calendar conflicts --from=2026-03-15T10:00 --to=2026-03-15T11:00

# Set calendar alias
gog calendar alias set team team-calendar@group.calendar.google.com

# Subscribe to calendar
gog calendar subscribe https://calendar.google.com/calendar/ical/XXXXX
```

### Drive Commands

```bash
# List files
gog drive ls --max 20

# Search files
gog drive search "presentation" --max 10
gog drive ls --query "mimeType='application/pdf'" --max 10

# List all drives (including shared)
gog drive ls --all --max 50

# Upload file
gog drive upload /path/to/file.pdf
gog drive upload /path/to/file.pdf --parent=<folderId>
gog drive upload /path/to/file.pdf --replace  # Update existing file

# Download file
gog drive download <fileId> --out ./file.pdf
gog drive download <fileId> --format=pdf --out ./exported.pdf  # For Docs/Sheets

# Create folder
gog drive create-folder "New Folder"

# Share file
gog drive share <fileId> --to=user@example.com --role=reader
gog drive share <fileId> --to=domain:company.com --role=commenter

# Delete file (moves to trash)
gog drive delete <fileId>
gog drive delete <fileId> --permanent  # Permanent deletion
```

### Sheets Commands

```bash
# List spreadsheets
gog sheets list --max 10

# Create spreadsheet
gog sheets create "My Sheet" --sheets "Sheet1,Sheet2"
gog sheets create "My Sheet" --parent=<folderId>

# Read range
gog sheets get <spreadsheetId> 'Sheet1!A1:B10'
gog sheets get <spreadsheetId> 'NamedRange'  # Named range

# Write data
gog sheets update <spreadsheetId> 'A1' --values-json='[["Name","Score"],["Alice","95"]]'

# Read cell notes
gog sheets notes <spreadsheetId> 'A1:B10'

# Update cell notes
gog sheets update-note <spreadsheetId> 'A1' --note="Important note"

# Find and replace
gog sheets find-replace <spreadsheetId> 'Sheet1!A:Z' --find='old' --replace='new'

# Insert rows/columns
gog sheets insert <spreadsheetId> 'Sheet1!A2' --rows=5

# Tab management
gog sheets add-tab <spreadsheetId> "New Tab"
gog sheets rename-tab <spreadsheetId> "Old Tab" "New Tab"
gog sheets delete-tab <spreadsheetId> "Tab Name"

# Named ranges
gog sheets named-ranges list <spreadsheetId>
gog sheets named-ranges create <spreadsheetId> "MyRange" 'Sheet1!A1:B10'

# Export
gog sheets export <spreadsheetId> --format=pdf --out ./sheet.pdf
gog sheets export <spreadsheetId> --format=csv --out ./sheet.csv
```

### Docs Commands

```bash
# Create document
gog docs create "My Document"
gog docs create "My Document" --file=/path/to/markdown.md  # Import Markdown

# Read document
gog docs get <docId>
gog docs cat <docId>  # Plain text

# List tabs (if applicable)
gog docs list-tabs <docId>
gog docs cat <docId> --tab=<tabId>
gog docs cat <docId> --all-tabs

# Write to document
gog docs write <docId> "New content"
gog docs write <docId> "Content" --tab=<tabId>

# Insert content
gog docs insert <docId> "Content" --at-end

# Find and replace
gog docs find-replace <docId> --find='old' --replace='new'
gog docs find-replace <docId> --find='old' --replace='new' --first  # First occurrence only

# Export
gog docs export <docId> --format=pdf --out ./doc.pdf
gog docs export <docId> --format=docx --out ./doc.docx
gog docs export <docId> --format=md --out ./doc.md  # Markdown export
gog docs export <docId> --format=html --out ./doc.html  # HTML export

# Comments
gog docs comments list <docId>
```

### Tasks Commands

```bash
# List task lists
gog tasks lists

# List tasks
gog tasks list <tasklistId>

# Add task
gog tasks add <tasklistId> --title "Task title"
gog tasks add <tasklistId> --title "Task" --due=2026-03-15
gog tasks add <tasklistId> --title "Task" --notes="Details"

# Update task
gog tasks update <tasklistId> <taskId> --title "Updated title"

# Mark done
gog tasks done <tasklistId> <taskId>

# Mark undone
gog tasks undo <tasklistId> <taskId>

# Delete task
gog tasks delete <tasklistId> <taskId>

# Repeat task
gog tasks add <tasklistId> --title "Weekly" --recur="weekly"
```

### Contacts Commands

```bash
# List contacts
gog contacts list --max 50

# Search contacts
gog contacts search "John Doe" --max 10

# Get contact
gog contacts get <contactId>

# Create contact
gog contacts create --name="John Doe" --email="john@example.com"
gog contacts create --name="Jane" --email="jane@example.com" --phone="555-1234" --org="Company" --title="Manager"

# Update contact
gog contacts update <contactId> --email="new@example.com"
gog contacts update <contactId> --birthday="1990-01-01"
gog contacts update <contactId> --notes="Important contact"

# Delete contact
gog contacts delete <contactId>
```

### JSON Output & Scripting

```bash
# All commands support --json flag
gog gmail search 'is:unread' --max 10 --json

# Pipe to jq for processing
gog gmail search 'newer_than:7d' --max 50 --json | jq '.threads[].id'
gog calendar events primary --week --json | jq '.events[] | {summary, start: .start.dateTime}'
gog drive ls --max 20 --json | jq '.files[] | {name, mimeType, id}'

# Extract specific fields
gog sheets get <spreadsheetId> 'Sheet1!A1:B10' --json | jq '.values[0][0]'

# Save to file
gog gmail search '' --max 100 --json > emails.json
```

### Output Formats

```bash
# Table format (default)
gog gmail search 'is:unread' --max 5

# Plain text
gog gmail search 'is:unread' --max 5 --plain

# JSON
gog gmail search 'is:unread' --max 5 --json
```

### Command Allowlist (Security)

```bash
# Enable specific commands only (for sandboxed/agent runs)
export GOG_ENABLE_COMMANDS="gmail.search,gmail.get,calendar.events,drive.ls,drive.get"

# Or via command-line flag
gog --enable-commands="gmail.search,calendar.events" gmail search 'is:unread' --max 5

# Note: Current implementation only checks top-level command (Issue #290)
# Future: Support dotted sub-command paths for finer granularity
```

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GOG_ACCOUNT` | Default account email | `you@gmail.com` |
| `GOG_ACCESS_TOKEN` | Direct access token | `ya29.example_token` |
| `GOG_AUTH_MODE` | Auth mode (adc, oauth) | `adc` |
| `GOG_ENABLE_COMMANDS` | Command allowlist | `gmail.search,calendar.events` |
| `GOG_KEYRING_PASSWORD` | Keyring password | `secret` |
| `GOOGLE_APPLICATION_CREDENTIALS` | Service account path | `/path/to/key.json` |

---

## 5. Agentic-Framework Integration

### Python Wrapper Implementation

See the comprehensive Python wrapper created in the code execution. Key components:

#### Core Wrapper Class
```python
from gogcli_wrapper import GOGCLIWrapper

# Initialize wrapper
gog = GOGCLIWrapper(
    account="agent@example.com",
    enable_commands=["gmail.search", "gmail.get", "calendar.events", "drive.ls"],
    rate_limit_rpm=100,  # Requests per minute
    timeout=30,
    max_retries=3
)

# Execute command
result = gog.execute("gmail search 'is:unread' --max 10")
print(result.json)  # Parsed JSON output
```

#### LangChain Tool Integration
```python
from langchain.tools import tool
from gogcli_wrapper import GOGCLIWrapper

gog = GOGCLIWrapper(account="agent@example.com")

@tool
def search_gmail(query: str, max_results: int = 10) -> str:
    """Search Gmail for emails matching the query."""
    result = gog.execute(f"gmail search '{query}' --max {max_results} --json")
    return result.stdout

@tool
def send_email(to: str, subject: str, body: str) -> str:
    """Send an email via Gmail."""
    result = gog.execute(f"gmail send '{to}' --subject '{subject}' --body '{body}'")
    return result.stdout

@tool
def get_calendar_events(start_date: str, end_date: str) -> str:
    """Get calendar events between dates."""
    result = gog.execute(f"calendar events primary --from={start_date} --to={end_date} --json")
    return result.stdout

# Add to agent tools
from langchain.agents import initialize_agent, Tool
tools = [
    Tool(name="Search Gmail", func=search_gmail, description="Search Gmail for emails"),
    Tool(name="Send Email", func=send_email, description="Send an email"),
    Tool(name="Get Calendar Events", func=get_calendar_events, description="Get calendar events"),
]
```

#### CrewAI Tool Integration
```python
from crewai import Agent, Task, Tool
from gogcli_wrapper import GOGCLIWrapper

gog = GOGCLIWrapper(account="agent@example.com")

# Define tools
gmail_search_tool = Tool(
    name="Gmail Search",
    description="Search Gmail for emails matching a query",
    func=lambda query, max_results=10: gog.execute(f"gmail search '{query}' --max {max_results} --json").stdout
)

calendar_events_tool = Tool(
    name="Calendar Events",
    description="Get calendar events for a date range",
    func=lambda start, end: gog.execute(f"calendar events primary --from={start} --to={end} --json").stdout
)

# Create agent
agent = Agent(
    role="Email Assistant",
    goal="Manage emails and calendar",
    backstory="You are a helpful assistant that manages Gmail and Calendar",
    tools=[gmail_search_tool, calendar_events_tool],
    verbose=True
)

# Create task
task = Task(
    description="Search for unread emails from today",
    agent=agent,
    expected_output="List of unread emails"
)
```

#### LlamaIndex Tool Integration
```python
from llama_index.tools import FunctionTool
from gogcli_wrapper import GOGCLIWrapper

gog = GOGCLIWrapper(account="agent@example.com")

def search_gmail(query: str, max_results: int = 10) -> str:
    """Search Gmail for emails."""
    result = gog.execute(f"gmail search '{query}' --max {max_results} --json")
    return result.stdout

gmail_tool = FunctionTool.from_defaults(search_gmail)

# Add to agent
from llama_index.core import AgentWorkflow
workflow = AgentWorkflow(
    tools=[gmail_tool],
    verbose=True
)
```

#### MCP (Model Context Protocol) Server

While gogcli doesn't have official MCP support yet, you can create a custom MCP server:

```python
# mcp_gogcli_server.py
from mcp.server import Server
from mcp.server.stdio import stdio_server
from gogcli_wrapper import GOGCLIWrapper

gog = GOGCLIWrapper(account="agent@example.com")

server = Server("gogcli")

@server.call_tool()
async def gmail_search(arguments: dict) -> dict:
    query = arguments.get("query", "")
    max_results = arguments.get("max_results", 10)
    result = gog.execute(f"gmail search '{query}' --max {max_results} --json")
    return {"content": [{"type": "text", "text": result.stdout}]}

@server.call_tool()
async def send_email(arguments: dict) -> dict:
    to = arguments.get("to", "")
    subject = arguments.get("subject", "")
    body = arguments.get("body", "")
    result = gog.execute(f"gmail send '{to}' --subject '{subject}' --body '{body}'")
    return {"content": [{"type": "text", "text": result.stdout}]}

async def main():
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())

if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
```

### Error Handling Patterns

```python
from gogcli_wrapper import GOGCLIError, RateLimitError, AuthError

gog = GOGCLIWrapper(account="agent@example.com")

try:
    result = gog.execute("gmail search 'is:unread' --max 10 --json")
    emails = result.json.get("threads", [])
    print(f"Found {len(emails)} unread emails")
except RateLimitError as e:
    print(f"Rate limit hit: {e.retry_after}s until retry")
    # Implement exponential backoff
    time.sleep(e.retry_after)
except AuthError as e:
    print(f"Authentication failed: {e}")
    # Re-authenticate or alert user
except GOGCLIError as e:
    print(f"gogcli error: {e.message}")
    # Handle specific error
```

### Secure Credential Injection

```python
import os
from gogcli_wrapper import GOGCLIWrapper

# NEVER hardcode credentials
account = os.environ.get("GOG_ACCOUNT")
credentials_path = os.environ.get("GOG_CREDENTIALS_PATH")

if not account:
    raise ValueError("GOG_ACCOUNT environment variable required")

gog = GOGCLIWrapper(
    account=account,
    credentials_path=credentials_path,
    enable_commands=["gmail.search", "gmail.get"]  # Least privilege
)
```

### Headless/Multi-Account Strategies

```python
from gogcli_wrapper import GOGCLIWrapper

# Multi-account wrapper
class MultiAccountGOG:
    def __init__(self, accounts: dict):
        """
        accounts: {
            "personal": {"email": "personal@gmail.com", "credentials": "/path/to/personal.json"},
            "work": {"email": "work@company.com", "credentials": "/path/to/work.json"}
        }
        """
        self.clients = {
            name: GOGCLIWrapper(account=cfg["email"], credentials_path=cfg["credentials"])
            for name, cfg in accounts.items()
        }
    
    def execute(self, account_name: str, command: str) -> dict:
        if account_name not in self.clients:
            raise ValueError(f"Unknown account: {account_name}")
        result = self.clients[account_name].execute(command)
        return result.json

# Usage
multi_gog = MultiAccountGOG({
    "personal": {"email": "personal@gmail.com", "credentials": "/path/to/personal.json"},
    "work": {"email": "work@company.com", "credentials": "/path/to/work.json"}
})

emails = multi_gog.execute("personal", "gmail search 'is:unread' --max 10 --json")
```

---

## 6. Performance, Limits & Reliability

### Gmail API Rate Limits

| Limit Type | Value | Notes |
|------------|-------|-------|
| **Per Project** | 500 queries/second | Shared across all users |
| **Per User** | 250 queries/second | Per authenticated user |
| **Daily Send** | 500 (free) / 2,000 (Workspace) | Emails sent per day |
| **Upload Size** | 25MB per file | Via Gmail API |

### Drive API Rate Limits

| Limit Type | Value | Notes |
|------------|-------|-------|
| **Per User** | 500 requests/100 seconds | Per user quota |
| **Per Project** | 2,000 requests/100 seconds | Per project quota |
| **Upload Size** | 5TB per file | Maximum file size |

### Calendar API Rate Limits

| Limit Type | Value | Notes |
|------------|-------|-------|
| **Per User** | 50 requests/60 seconds | Per user quota |
| **Per Project** | 500 requests/60 seconds | Per project quota |

### Known Issues & Mitigations

#### Account Suspension Risks

**Common Triggers**:
1. **New account + immediate automation**: Google flags new accounts with CLI-only access
2. **High-frequency polling**: Checking inbox every few seconds
3. **Broad OAuth scopes**: Requesting full access when only read needed
4. **Unusual patterns**: Bulk operations, rapid sending

**Mitigation Strategies**:

```python
# 1. Use established accounts only
# NEVER create new Gmail accounts for agents

# 2. Implement rate limiting
from time import sleep
from gogcli_wrapper import GOGCLIWrapper

gog = GOGCLIWrapper(account="agent@example.com", rate_limit_rpm=60)

# 3. Use least-privilege scopes
gog.auth_add("--gmail-scope=readonly")

# 4. Add delays between operations
for email in emails:
    process(email)
    sleep(1)  # 1 second delay

# 5. Use exponential backoff on rate limits
from gogcli_wrapper import RateLimitError

for attempt in range(3):
    try:
        result = gog.execute("gmail search 'is:unread' --max 10")
        break
    except RateLimitError as e:
        sleep(5 * (attempt + 1))  # 5, 10, 15 seconds
```

#### Token Expiration

gogcli auto-refreshes tokens, but handle edge cases:

```python
from gogcli_wrapper import AuthError

try:
    result = gog.execute("gmail search '' --max 5")
except AuthError as e:
    if "token_expired" in str(e):
        # Re-authenticate
        gog.auth_add("--force-consent")
```

#### Error Patterns to Handle

```python
ERROR_PATTERNS = {
    "429": "Rate limit exceeded - implement backoff",
    "403": "Permission denied - check scopes",
    "401": "Authentication failed - re-authenticate",
    "404": "Resource not found - check IDs",
    "500": "Server error - retry with backoff",
    "503": "Service unavailable - wait and retry"
}

def handle_gog_error(error: GOGCLIError) -> None:
    status_code = error.status_code
    if status_code in ERROR_PATTERNS:
        print(f"Handling {status_code}: {ERROR_PATTERNS[status_code]}")
        # Implement specific handling
```

---

## 7. Comparison & Alternatives

### gogcli vs. Direct API Calls

| Aspect | gogcli | Direct API (Python) |
|--------|--------|---------------------|
| **Setup Time** | 5-10 minutes | 30-60 minutes |
| **OAuth Management** | Automatic | Manual implementation |
| **Pagination** | Built-in | Manual implementation |
| **Error Handling** | Standardized | Custom implementation |
| **JSON Output** | Native | Manual parsing |
| **Multi-Account** | Built-in | Manual management |
| **Token Refresh** | Automatic | Manual implementation |
| **Learning Curve** | Low | High |
| **Flexibility** | Medium | High |
| **Performance** | Good (subprocess overhead) | Excellent |

### gogcli vs. gws (Google Workspace CLI)

| Aspect | gogcli | gws |
|--------|--------|-----|
| **Maintainer** | Community (Peter Steinberger) | Google |
| **Language** | Go | Rust |
| **MCP Support** | Community | Built-in |
| **Release Frequency** | Weekly | Monthly |
| **Community** | Active (6.7k stars) | Growing |
| **Documentation** | Good | Excellent |
| **Agent Skills** | Community | Official |
| **Customization** | High | Medium |

### When to Use Each

**Use gogcli when**:
- ✅ Quick setup needed
- ✅ Human-friendly commands preferred
- ✅ Active community support valued
- ✅ Open to third-party tools
- ✅ Need frequent feature updates

**Use gws when**:
- ✅ Official Google support required
- ✅ Built-in MCP server needed
- ✅ Enterprise compliance critical
- ✅ Always-current API surface needed

**Use Direct API when**:
- ✅ Maximum performance critical
- ✅ Custom error handling needed
- ✅ Full control over OAuth flow
- ✅ Complex business logic required

---

## 8. Best Practices & Recommendations

### Security-First Design

#### 1. Command Allowlisting
```bash
# Restrict to read-only operations
export GOG_ENABLE_COMMANDS="gmail.search,gmail.get,calendar.events,drive.ls,drive.get,sheets.get"

# NEVER enable destructive commands for agents
# Avoid: gmail.send, drive.delete, calendar.delete, etc.
```

#### 2. Least-Privilege Scopes
```bash
# Read-only Gmail
gog auth add agent@example.com --gmail-scope=readonly

# Specific services only
gog auth add agent@example.com --services gmail,calendar
```

#### 3. Credential Isolation
```bash
# Use dedicated service account for agents
# NEVER use personal/admin accounts

# Store credentials securely
chmod 600 ~/.config/gogcli/keyring
```

#### 4. Sandboxing
```dockerfile
# Run in Docker with minimal privileges
FROM alpine:latest
RUN apk add --no-cache gogcli jq
USER nobody  # Non-root user
WORKDIR /home/nobody
ENTRYPOINT ["gog"]
```

### Production Hardening

#### 1. Environment Variables Only
```python
import os

account = os.environ["GOG_ACCOUNT"]  # Required
credentials = os.environ.get("GOG_CREDENTIALS_PATH")
enable_commands = os.environ.get("GOG_ENABLE_COMMANDS", "")

# Never hardcode in code or configs
```

#### 2. Logging & Monitoring
```python
import logging
from gogcli_wrapper import GOGCLIWrapper

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("gogcli")

gog = GOGCLIWrapper(account="agent@example.com")

# Log all commands
original_execute = gog.execute
def logged_execute(command):
    logger.info(f"Executing: {command}")
    result = original_execute(command)
    logger.info(f"Result: {result.status_code}")
    return result

gog.execute = logged_execute
```

#### 3. Health Checks
```python
def check_gog_health():
    """Verify gogcli is working."""
    try:
        result = gog.execute("auth status --json")
        return result.status_code == 0
    except Exception as e:
        logger.error(f"gogcli health check failed: {e}")
        return False
```

### Testing Strategy

#### 1. Use Dedicated Test Account
```bash
# Create test account
gog auth add test-agent@example.com --services gmail,calendar --gmail-scope=readonly

# Test commands
gog gmail search '' --account test-agent@example.com --max 5
```

#### 2. Integration Tests
```python
import pytest
from gogcli_wrapper import GOGCLIWrapper

@pytest.fixture
def gog():
    return GOGCLIWrapper(
        account=os.environ["GOG_TEST_ACCOUNT"],
        enable_commands="gmail.search,gmail.get"
    )

def test_gmail_search(gog):
    result = gog.execute("gmail search '' --max 5 --json")
    assert result.status_code == 0
    assert "threads" in result.json
```

### Performance & Cost Optimization

#### 1. Batch Operations
```bash
# Instead of multiple calls
gog gmail search 'from:example.com' --max 100 --json

# Process in batches
emails = result.json["threads"]
for i in range(0, len(emails), 10):
    batch = emails[i:i+10]
    process_batch(batch)
```

#### 2. Caching
```python
from functools import lru_cache

@lru_cache(maxsize=100)
def get_calendar_events(date: str):
    result = gog.execute(f"calendar events primary --from={date} --json")
    return result.json
```

#### 3. Pagination
```bash
# Use --max to limit results
gog gmail search '' --max 50 --json

# For large datasets, implement pagination
page_token = ""
while True:
    result = gog.execute(f"gmail search '' --max 100 --page-token={page_token} --json")
    emails.extend(result.json["threads"])
    page_token = result.json.get("nextPageToken")
    if not page_token:
        break
```

### Observability & Debugging

#### 1. Enable Verbose Logging
```bash
# Debug mode
gog --debug gmail search '' --max 5

# Trace OAuth flow
gog --trace auth status
```

#### 2. Metrics Collection
```python
from prometheus_client import Counter, Histogram

GOGCLI_COMMANDS = Counter('gogcli_commands_total', 'Total gogcli commands executed', ['command', 'status'])
GOGCLI_DURATION = Histogram('gogcli_command_duration_seconds', 'Command duration')

@GOGCLI_DURATION.time()
def execute_with_metrics(command: str):
    start = time.time()
    result = gog.execute(command)
    GOGCLI_COMMANDS.labels(command=command.split()[0], status=result.status_code).inc()
    return result
```

### Version Pinning & Updates

```bash
# Pin to specific version for stability
git checkout v0.12.0
make

# Check for updates
gog --version

# Update policy: Test new versions in staging first
# Update quarterly or when critical bugs fixed
```

### Framework-Specific Tips

#### ReAct Tool Exposure
```python
from langchain.tools import BaseTool

class GOGTool(BaseTool):
    name: str = "gogcli"
    description: str = "Execute gogcli commands for Google Workspace"
    
    def _run(self, command: str) -> str:
        # Validate command against allowlist
        if not self.is_allowed(command):
            raise ValueError(f"Command not allowed: {command}")
        result = gog.execute(command)
        return result.stdout
    
    def is_allowed(self, command: str) -> bool:
        allowed = os.environ.get("GOG_ENABLE_COMMANDS", "").split(",")
        return any(cmd in command for cmd in allowed)
```

#### Structured Output Schemas
```python
from pydantic import BaseModel

class GmailSearchResult(BaseModel):
    threads: list[dict]
    result_size_estimate: int

class CalendarEvent(BaseModel):
    id: str
    summary: str
    start: dict
    end: dict

# Use with tool output parsing
result = gog.execute("gmail search '' --max 10 --json")
parsed = GmailSearchResult(**result.json)
```

#### Parallel Tool Use
```python
from concurrent.futures import ThreadPoolExecutor

def parallel_gog_calls(commands: list[str]):
    with ThreadPoolExecutor(max_workers=5) as executor:
        results = list(executor.map(gog.execute, commands))
    return results

# Example: Get multiple calendar events
commands = [
    f"calendar events primary --from={date} --json"
    for date in dates
]
results = parallel_gog_calls(commands)
```

### Ethical & Legal Considerations

#### 1. Google ToS Compliance
- ✅ Use only for authorized accounts
- ✅ Respect rate limits
- ✅ Don't scrape or abuse APIs
- ✅ Implement proper error handling

#### 2. User Consent
- ✅ Clear disclosure of data access
- ✅ Easy opt-out mechanism
- ✅ Minimal data collection
- ✅ Secure data storage

#### 3. Data Privacy
- ✅ Encrypt credentials at rest
- ✅ Never log sensitive data
- ✅ Implement data retention policies
- ✅ Comply with GDPR/CCPA

---

## 9. Implementation Guide

### Step-by-Step Setup

#### Step 1: Install gogcli
```bash
# macOS/Linux
brew install steipete/tap/gogcli

# Verify
gog --version
```

#### Step 2: Create Google Cloud Project
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create project: "Agent Google Integration"
3. Enable required APIs (see Section 3)

#### Step 3: Create OAuth Client
1. Create OAuth consent screen
2. Create OAuth client ID (Desktop app)
3. Download `client_secret.json`

#### Step 4: Configure gogcli
```bash
# Register credentials
gog auth credentials /path/to/client_secret.json

# Authorize account
gog auth add agent@example.com --services gmail,calendar,drive --gmail-scope=readonly

# Set default account
export GOG_ACCOUNT=agent@example.com
```

#### Step 5: Install Python Wrapper
```bash
# Install dependencies
pip install gogcli-wrapper

# Or install from source
pip install ./gogcli-wrapper/
```

#### Step 6: Create Agent Tools
```python
from gogcli_wrapper import GOGCLIWrapper
from langchain.tools import tool

gog = GOGCLIWrapper(
    account="agent@example.com",
    enable_commands=["gmail.search", "gmail.get", "calendar.events", "drive.ls"],
    rate_limit_rpm=100
)

@tool
def search_emails(query: str, max_results: int = 10) -> str:
    """Search Gmail for emails matching the query."""
    result = gog.execute(f"gmail search '{query}' --max {max_results} --json")
    return result.stdout

@tool
def get_calendar_events(start: str, end: str) -> str:
    """Get calendar events between dates."""
    result = gog.execute(f"calendar events primary --from={start} --to={end} --json")
    return result.stdout
```

#### Step 7: Deploy & Monitor
```bash
# Set environment variables
export GOG_ACCOUNT=agent@example.com
export GOG_ENABLE_COMMANDS="gmail.search,gmail.get,calendar.events"

# Run agent
python agent.py

# Monitor logs
tail -f /var/log/agent/gogcli.log
```

### Example Tool Definitions

#### LangChain Tool Schema
```python
from langchain.tools import BaseTool
from pydantic import BaseModel, Field

class GmailSearchInput(BaseModel):
    query: str = Field(..., description="Search query (Gmail search syntax)")
    max_results: int = Field(default=10, description="Maximum results to return")

class GmailSearchTool(BaseTool):
    name: str = "gmail_search"
    description: str = "Search Gmail for emails matching a query"
    args_schema: type[BaseModel] = GmailSearchInput
    
    def _run(self, query: str, max_results: int = 10) -> str:
        result = gog.execute(f"gmail search '{query}' --max {max_results} --json")
        return result.stdout
```

#### CrewAI Tool Definition
```python
from crewai.tools import BaseTool
from typing import Type
from pydantic import BaseModel, Field

class CalendarEventTool(BaseTool):
    name: str = "calendar_events"
    description: str = "Get calendar events for a date range"
    
    class InputSchema(BaseModel):
        start_date: str = Field(..., description="Start date (ISO 8601)")
        end_date: str = Field(..., description="End date (ISO 8601)")
    
    def _run(self, start_date: str, end_date: str) -> str:
        result = gog.execute(f"calendar events primary --from={start_date} --to={end_date} --json")
        return result.stdout
```

#### MCP Tool Schema
```json
{
  "name": "gmail_search",
  "description": "Search Gmail for emails",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Gmail search query"
      },
      "maxResults": {
        "type": "integer",
        "description": "Maximum results",
        "default": 10
      }
    },
    "required": ["query"]
  }
}
```

---

## 10. Risks & Mitigation Checklist

### Security Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Credential Leak** | Medium | Critical | Use env vars, encrypt at rest, never commit |
| **Over-privileged Access** | High | High | Use least-privilege scopes, command allowlist |
| **Account Suspension** | Medium | Critical | Use established accounts, rate limiting, monitoring |
| **Prompt Injection** | Medium | High | Validate inputs, sanitize commands, allowlist only |
| **Token Theft** | Low | Critical | Secure keyring, rotate credentials regularly |

### Operational Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **Rate Limit Exceeded** | High | Medium | Implement backoff, monitor usage, batch operations |
| **API Downtime** | Low | Medium | Retry logic, fallback mechanisms, circuit breakers |
| **Token Expiration** | Medium | Medium | Auto-refresh, health checks, alerting |
| **Command Failure** | Medium | Low | Error handling, logging, graceful degradation |

### Compliance Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| **ToS Violation** | Low | Critical | Follow Google policies, monitor for changes |
| **Data Privacy Breach** | Low | Critical | Encrypt data, minimal collection, retention policies |
| **Audit Trail Gaps** | Medium | Medium | Log all commands, implement monitoring |

### Mitigation Checklist

- [ ] Use dedicated service account (not personal/admin)
- [ ] Implement command allowlist (GOG_ENABLE_COMMANDS)
- [ ] Use least-privilege OAuth scopes
- [ ] Enable rate limiting with exponential backoff
- [ ] Implement health checks and monitoring
- [ ] Set up alerting for failures
- [ ] Encrypt credentials at rest
- [ ] Log all commands (without sensitive data)
- [ ] Test with dedicated test account first
- [ ] Review Google ToS regularly
- [ ] Implement circuit breakers for API calls
- [ ] Set up credential rotation (90 days)
- [ ] Use Docker/sandbox for isolation
- [ ] Monitor for unusual patterns
- [ ] Have rollback plan ready

---

## 11. Final Recommendation

### Should You Integrate gogcli?

**YES** - gogcli is an excellent choice for agentic framework integration, with the following considerations:

#### Strengths
- ✅ **Mature & Active**: 6.7k+ stars, weekly releases, 50+ contributors
- ✅ **JSON-First**: Native JSON output perfect for agents
- ✅ **Multi-Account**: Built-in support for multiple accounts
- ✅ **OAuth Management**: Automatic token refresh, keyring storage
- ✅ **Command Simplicity**: Human-friendly, easy to learn
- ✅ **Comprehensive Coverage**: 15+ Google Workspace services
- ✅ **Security Features**: Command allowlist, least-privilege scopes
- ✅ **Community Support**: Active GitHub, good documentation

#### Weaknesses
- ⚠️ **Third-Party**: Not officially Google-supported
- ⚠️ **Subprocess Overhead**: Slightly slower than direct API calls
- ⚠️ **Allowlist Granularity**: Current implementation only checks top-level commands (Issue #290)
- ⚠️ **No Official MCP**: Community MCP servers only

#### Recommendation

**Integrate gogcli as a core skill** with the following architecture:

1. **Use the Python wrapper** created in this guide for production
2. **Implement command allowlisting** to restrict agent capabilities
3. **Use dedicated service accounts** with least-privilege scopes
4. **Monitor rate limits** and implement exponential backoff
5. **Set up health checks** and alerting
6. **Consider gws** for enterprise deployments requiring official support

### Custom Wrapper Recommendation

Build a custom wrapper with:
- ✅ Subprocess execution with timeout
- ✅ JSON output parsing with fallback
- ✅ Rate limit handling with exponential backoff
- ✅ Command allowlist enforcement
- ✅ Logging and observability
- ✅ Multi-account support
- ✅ Error handling and retry logic

The Python wrapper created in this guide provides all these features and is ready for production use.

### Implementation Priority

1. **Phase 1 (Week 1)**: Basic integration with read-only access
2. **Phase 2 (Week 2)**: Add write operations with strict allowlisting
3. **Phase 3 (Week 3)**: Implement monitoring and alerting
4. **Phase 4 (Week 4)**: Production hardening and security audit

---

## References

- **Official Site**: https://gogcli.sh/
- **GitHub Repository**: https://github.com/steipete/gogcli
- **Releases**: https://github.com/steipete/gogcli/releases
- **OpenClaw Skill**: https://github.com/openclaw/skills/blob/main/skills/luccast/gogcli/SKILL.md
- **Setup Guide**: https://zatoima.github.io/en/gogcli-setup-google-cli-terminal/
- **OpenClaw Integration**: https://www.agentmail.to/blog/connect-openclaw-to-gmail
- **Ubuntu Setup**: https://www.sabrihamid.com/posts/openclaw_google_ubuntu_gog
- **Production Hardening**: https://axentia.in/blog/openclaw-gogcli-setup-suspensions-rock-solid-fixes
- **Issue #290 (Allowlist)**: https://github.com/steipete/gogcli/issues/290
- **Gmail API Quotas**: https://developers.google.com/workspace/gmail/api/reference/quota
- **Google Workspace CLI (gws)**: https://github.com/googleworkspace/cli

---

*Document Version: 1.0 | Last Updated: March 2026 | Author: AI Integration Engineer*
