# Building a Local Multimodal Streaming Chatbot in Elixir

This tutorial will guide you through creating a terminal-based chatbot in Elixir that supports text, images, and audio as input, using a local LLM for inference.

## Prerequisites

- **Elixir (v1.15+)** installed.
- **Ollama** installed (to run the LLM locally).
- **FFmpeg** installed (to handle media file processing).

## 1. Setup the Project

Create a new Elixir project:
```bash
mix new elixir_llm_bot
cd elixir_llm_bot
```

## 2. Dependencies

Add the necessary dependencies to `mix.exs`. We will use `nx`, `bumblebee`, and `ex_ollama` (or direct HTTP calls to the Ollama API).

*For this tutorial, we will use HTTP calls via `req` for simplicity.*

Add to `mix.exs`:
```elixir
defp deps do
  [
    {:req, "~> 0.5.0"},
    {:jason, "~> 1.4"}
  ]
end
```
Run `mix deps.get`.

## 3. The Backend: Ollama

Ensure you have Ollama running, and pull a multimodal model like `llava`:
```bash
ollama serve
ollama pull llava
```

## 4. Building the Application

Create `lib/elixir_llm_bot.ex`. We will structure this to take input, format it for the Ollama API, and stream the response back.

```elixir
defmodule ElixirLlmBot do
  @url "http://localhost:11434/api/generate"

  def chat(prompt, media_path \\ nil) do
    payload = %{
      model: "llava",
      prompt: prompt,
      images: encode_media(media_path),
      stream: true
    }

    Req.post!(@url, json: payload, into: IO.stream(:stdio, :line), receive_timeout: 60_000)
  end

  defp encode_media(nil), do: []
  defp encode_media(path) do
    # Read file and Base64 encode
    [Base.encode64(File.read!(path))]
  end
end
```

## 5. Building the Terminal Interface

Update `lib/elixir_llm_bot/cli.ex` to handle user input loop.

```elixir
defmodule ElixirLlmBot.CLI do
  def start do
    IO.puts "Chatbot ready (Type 'exit' to quit)."
    loop()
  end

  defp loop do
    input = IO.gets("> ") |> String.trim()
    if input == "exit", do: :ok, else: handle_input(input)
  end

  defp handle_input(input) do
    # Simple logic: check if input is a file path
    if File.exists?(input) do
      IO.write "Prompt for media: "
      prompt = IO.gets("") |> String.trim()
      ElixirLlmBot.chat(prompt, input)
    else
      ElixirLlmBot.chat(input)
    end
    loop()
  end
end
```

## 6. Running the Bot

Update your `mix.exs` to include an escript so you can run it as a standalone executable:

```elixir
def project do
  [
    app: :elixir_llm_bot,
    version: "0.1.0",
    escript: [main_module: ElixirLlmBot.CLI]
  ]
end
```

Build and run:
```bash
mix escript.build
./elixir_llm_bot
```

## How it works

1. **Req**: Handles the HTTP streaming connection to Ollama.
2. **Ollama**: Provides the LLM logic. By passing `images` in the JSON body, the `llava` model handles vision tasks.
3. **IO.stream**: Pipes the incoming streaming data directly to the terminal's standard output, providing a real-time typing effect.
