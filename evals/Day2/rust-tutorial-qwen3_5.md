# Learning Rust: A Guide for Intermediate JavaScript/TypeScript Developers

## Table of Contents

1. [Introduction](#introduction)
2. [Why Learn Rust?](#why-learn-rust)
3. [Getting Started](#getting-started)
4. [Core Concepts for JS/TS Developers](#core-concepts-for-js-ts-developers)
   - [Variables and Types](#variables-and-types)
   - [Mutable vs Immutable](#mutable-vs-immutable)
   - [Ownership and Borrowing](#ownership-and-borrowing)
   - [Stack vs Heap](#stack-vs-heap)
5. [Error Handling](#error-handling)
6. [Traits: Rust's Version of Interfaces](#traits:-rusts-version-of-interfaces)
7. [Modules and Crate Systems](#modules-and-crate-systems)
8. [Testing in Rust](#testing-in-rust)
9. [Advanced Concepts](#advanced-concepts)
10. [Resources for Further Learning](#resources-for-further-learning)

---

## Introduction

Welcome! This tutorial is designed specifically for intermediate JavaScript/TypeScript developers who want to learn Rust. You already know about:

- **Dynamic typing** (JS) vs **static typing** (TS)
- **Objects and primitives**
- **Async/await patterns**
- **Module systems**
- **Testing frameworks**

Rust brings a completely different approach to programming, particularly around memory management and safety. Let's dive in!

---

## Why Learn Rust?

| Feature | JavaScript/TypeScript | Rust |
|---------|----------------------|------|
| Memory Management | Garbage Collector | Compile-time ownership |
| Concurrency | Event loops, Promises | Safe thread primitives |
| Performance | V8 JIT compilation | Zero-cost abstractions |
| Type Safety | Optional (TS) | Mandatory (compile-time) |
| Systems Programming | FFI required | Native support |

**Why Rust?**
- Prevents memory leaks, data races, and null pointer dereferences
- No garbage collector overhead
- Compiles to machine code you can audit
- Excellent for embedded systems, WebAssembly, and system programming

---

## Getting Started

### Installation

**Prerequisites:**
- 64-bit operating system (Linux, macOS, Windows 10+)
- Git (for Rust toolchain dependencies)

**Install Rust:**

```bash
# The official installer
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Or via Cargo in one command
cargo install rustup-init
```

**Verify Installation:**
```bash
rustc --version
cargo --version
rustup --version
```

### Hello World

Create and run your first Rust program:

```bash
# Create a new project
cargo new hello-world
cd hello-world

# Run the project
cargo run

# View the generated code
cat src/main.rs
```

```rust
// src/main.rs
fn main() {
    println!("Hello, world!");
}
```

---

## Core Concepts for JS/TS Developers

### Variables and Types

| JavaScript | TypeScript | Rust |
|------------|-------------|------|
| `const a = 5` | `const a: number = 5` | `let a = 5;` |
| `var b = "hello"` | `let b: string = "hello"` | `let b = String::from("hello");` |
| Optional `a?: number` | `function foo(a?: number)` | `fn foo(a: Option<i32>)` |

**Type Inference vs Explicit Types:**

```rust
// Rust - Explicit types (like TS)
let a: i32 = 42;
let b: f64 = 2.0;
let c: String = String::from("Rust");

// Type inference (like JS!)
let d = 100;        // inferred as i32
let e = 100.5f64;   // inferred as f64
let f: bool = true;

// Enum (like TS enum)
enum Direction {
    North,
    South,
    East,
    West,
}
```

### Mutable vs Immutable

Rust emphasizes immutability by default:

```rust
// Immutable - like const/readonly in TS!
let config: String = String::from("production");

// To mutate, you need to mark as mutable
let mut data = vec![1, 2, 3];
data.push(4);

// JS/TS comparison:
// TS: const config = "production"
// Rust: let config = "production" (immutable)
//       let mut config = "production" (mutable)
```

### Ownership and Borrowing

**This is the most important concept in Rust! ⚠️**

Ownership eliminates:
- Memory leaks (no GC needed)
- Data races at runtime
- Null pointer dereferences (mostly)

#### Three Golden Rules:

1. **Each value has a single owner**
2. **Whenowner goes out of scope, value is dropped**
3. **Move semantics on assignment**

```rust
// Ownership transfer (move semantics)
let s1 = String::from("hello");
let s2 = s1;  // s1 is now invalid, ownership moved to s2

// After this line, s1 cannot be used anymore!
// println!("{}", s1); // Compile error!

// Borrowing - getting a reference without moving
let s = String::from("hello");
let r1 = &s;   // & creates a borrow (like a reference in TS)
let r2 = &s;   // multiple borrows allowed

println!("{} and {}", r1, r2);  // Works!
drop(r1);  // Explicitly drop the borrow
println!("{}", s);  // Still works!
```

#### Stack vs Heap

Think of this like managing object lifetimes in JS:

```rust
// Stack (automatic cleanup like temp JS variables)
let x: i32 = 42;
let s: i32 = 100;

// Heap (needs explicit allocation/deallocation)
let name = String::from("Hello");  // Heap!
{
    let y = 10;  // Stack, lives in this scope
}  // y dropped automatically here


```

#### The Borrow Checker

Rust's borrow checker ensures memory safety at compile time. It's strict but powerful:

```rust
// ❌ ERROR: Multiple mutable borrows
let mut s = String::from("hello");
let r1 = &mut s;
let r2 = &mut s;  // ERROR: cannot borrow s as mutable more than once

// ✅ OK: One mutable, any number of immutable
let s = String::from("hello");
let r1 = &s;  // immutable borrow
let r2 = &s;  // another immutable borrow
println!("{}, {}!", r1, r2);

// ✅ OK: One mutable, one immutable (but can't use s itself)
let mut s = String::from("hello");
let r1 = &s;    // immutable borrow
println!("with {}!", r1);
let r2 = &mut s; // mutable borrow
r2.push(',');
// println!("{}", s); // ERROR! s can't be used

```

#### Lifetimes

Lifetimes tell Rust how long references are valid. Think of it as dependency resolution for references.

```rust
// Without lifetime annotation - Rust infers it
fn longest(x: &str, y: &str) -> &str {
    if x.len() > y.len() {
        x
    } else {
        y
    }
}

// The function returns a reference that lives as long as the longer input

// Explicit lifetime annotation
fn longer<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() {
        x
    } else {
        y
    }
}

// Structural lifetime - checking multiple lifetimes
fn complex<'a, 'b>(x: &'a str, y: &'b str) 
    -> Box<dyn Iterator<Item = &str> + 'a + 'b> {
    // x's lifetime is 'a, y's is 'b, result can't outlive either
}
```

---

## Error Handling

Rust enforces error handling at compile time with `Result` and `Option`.

### Option Type

`Option<T>` represents a value that might or might not exist.

```rust
// Nullable values
let maybe_number: Option<i32> = None;
let maybe_value: Option<i32> = Some(42);

// Pattern matching (like TS switch/case)
let result = match maybe_number {
    Some(n) => println!("Got {}", n),
    None => println!("No value"),
};

// Using the operator
if let Some(n) = maybe_number {
    println!("Value: {}", n);
}

// With ? operator for early return (like returning undefined/error)
fn find_config() -> Result<String, String> {
    maybe_value = value.map(|v| format!("Option {}", v))
}
```

### Result Type

`Result<T, E>` represents success (`Ok(T)`) or failure (`Err(E)`)

```rust
// Success and error types
fn divide(a: f32, b: f32) -> Result<f32, String> {
    if b == 0.0 {
        Err("Cannot divide by zero!".to_string())
    } else {
        Ok(a / b)
    }
}

// ? operator for propagation (like TypeScript's early return)
fn process() -> Result<(), String> {
    let number = maybe_value
        .map(|n| n * 2)
        .and_then(|n| find_config());?
}
```

### The ? Operator

Propagates errors instead of panicking (JS `throw`):

```rust
use std::fs;

fn read_file(path: &str) -> Result<String, Box<dyn std::error::Error>> {
    fs::read_to_string(path)?;  // Error propagates
    Ok(content.to_string())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let content = read_file("config.txt")?;
    println!("Content: {}", content);
    Ok(())
}
```

### Custom Errors

```rust
// ✅ Recommended: use thiserror! macro
#[derive(Debug, thiserror::Error)]
enum Error {
    IoError(std::io::Error),    // Propagate IO errors
    FileNotFound(String),        // User-friendly errors
    DivisionByZero,              // Application-specific
}

let error = Error::FileNotFound("file.txt".to_string());
```

---

## Traits: Rust's Version of Interfaces

Traits in Rust are similar to TypeScript interfaces, but they're both declarations AND implementations.

```rust
// Like TypeScript interface
trait Printable {
    fn print(&self);
}

// Implementation (implements trait like class implements interface)
struct User {
    name: String,
}

impl Printable for User {
    fn print(&self) {
        println!("User: {}", self.name);
    }
}

// Generic trait like TS generics
trait Container<T> {
    fn get(&self) -> &T;
}

struct Array<T> {
    data: Vec<T>,
}

impl<T> Container<T> for Array<T> {
    fn get(&self) -> &T {
        &self.data[0]
    }
}
```

### Traits vs TypeScript Interfaces

| Feature | TypeScript | Rust |
|---------|-----------|------|
| Default implementation | No | Yes |
| Static dispatch | Via generics | Via trait bounds |
| Dynamic dispatch | Via any/typeof | Via trait object |

```rust
// Default trait implementation
trait Debug {
    fn debug_print(&self);
    
    // Default implementation for all structs
    fn default_print(&self) {
        self.debug_print();
    }
}

struct Example {
    name: String,
}

impl Debug for Example {
    fn debug_print(&self) {
        println!("Debug: {}", self.name);
    }
    
    // Can override
    fn default_print(&self) {
        self.name;
    }
}
```

---

## Modules and Crate Systems

### Crate Structure (like packages in Node.js)

```
my-project/
├── Cargo.toml          # Package manifest (package.json)
├── src/
│   ├── main.rs         # Binary entry point
│   └── lib.rs          # Library entry point
├── src/
│   ├── lib.rs          # Library root
│   ├── models/
│   │   └── user.rs
│   ├── services/
│   │   └── auth.rs
│   └── utils/
│       └── helpers.rs
└── tests/               # Integration tests

```

**Cargo.toml (like package.json):**

```toml
[package]
name = "my-project"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = { version = "1", features = ["full"] }
chrono = "0.4"

[dev-dependencies]
mockito = "1.0"

[profile.release]
opt-level = 3
```

### Public vs Private (like export/import in TS)

```rust
// Public items (like export default)
pub fn public_function() {}

struct StructName;  // Private by default

pub struct PublicStruct;  // Public struct

// Module with visibility
mod internal {
    pub fn internal_func() {}
}

pub mod public {
    use crate::models::user::User;
    
    pub use internal::internal_func;
}
```

---

## Testing in Rust

Rust has built-in testing with cargo:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = add(2, 2);
        assert_eq!(result, 4);
    }

    #[test]
    fn it_add_two_numbers() {
        let sum = add(1, 2);
        assert_eq!(sum, 3);
    }

    #[test]
    #[ignore]  // Skip test (like skip in Jest)
    fn slow_test() {
        // This test is slow and should be ignored
    }
}
```

**Running tests:**

```bash
# Run all tests
cargo test

# Run specific test
cargo test add_two_numbers

# Run with verbose output
cargo test -- --nocapture

# Run in debug mode (default)
cargo test

# Run in release mode
cargo test --release
```

---

## Advanced Concepts

### Generics

```rust
// Generic function
fn main<T>(t: T) {
    println!("Got a {}", t);
}

// Generic struct
struct Point<T> {
    x: T,
    y: T,
}

impl<T: PartialOrd> Point<T> {
    fn max_point(&self) -> T {
        if self.x > self.y {
            self.x
        } else {
            self.y
        }
    }
}
```

### Iterator Pattern (like async iteration in TS)

```rust
// Iterators work like array methods in JS
let numbers = vec![1, 2, 3, 4, 5];

let result: Vec<_> = numbers.iter()
    .filter(|&&n| n % 2 == 0)
    .map(|&n| n * 2)
    .collect();

// Using closure (like function argument)
let doubled = numbers.iter().map(|n| n * 2).collect::<Vec<_>>();
```

### Async/Await in Rust

Async Rust uses `Future` trait and requires async/await support in nightly stable:

```rust
#[tokio::main]
async fn main() {
    let handle = async {
        // Async code here
    };
    
    let _ = handle.await;
}
```

### Pattern Matching

```rust
// Match expression (like switch/case)
let status_code = 404;

let message = match status_code {
    200 => "OK",
    404 => "Not Found",
    403 => "Forbidden",
    _ => "Unknown",
};

// With guard conditions
match response {
    200 | 201 => "Created",
    status if status >= 500 && status < 600 => format!("Error code {}", status),
    _ => "Other",
}

// Tuple pattern
let (x, y) = point;

// Struct pattern
let Point { x, y } = point;
```

---

## Resources for Further Learning

### Must-Read Resources (Ordered by Difficulty)

1. **The Book** - Official Rust Language Guide
   - URL: https://doc.rust-lang.org/book/
   - Start with Chapter 4: Understanding Ownership

2. **Rust By Example** - Learn by doing
   - URL: https://rustbyexample.com/

3. **Rustlings** - Small exercises
   - URL: https://rustlings.cool/

4. **Practical Rust** (Primal) - Modern Rust guide
   - URL: https://practicalrust.dev/

5. **Rust for TypeScript Developers** - Specifically for TS devs
   - URL: https://theprimeagen.github.io/rust-for-typescript-devs/

### Cheat Sheets

- **Common Patterns**: https://doc.rust-lang.org/rust-by-example/
- **Type System**: https://www.rustdoc.rs/type-system/
- **Error Handling**: https://internals.rust-lang.org/result-option/

### Tools

- **rustup** - Rust toolchain manager
- **cargo** - Package manager and build system
- **rustfmt** - Code formatter
- **clippy** - Linter for common mistakes

### Community

- **Stack Overflow** - Tag: [rust]
- **Rust Discord** - https://discord.gg/rust-lang
- **Rust Users Forum** - https://users.rust-lang.org/

---

## Common Pitfalls for JS/TS Developers

### 1. Borrow Checker Confusion

**Problem:** You get error about multiple borrows.

**Solution:** Think of borrows as loaned references, not copies.

```rust
// ❌ Wrong
let s = String::from("hello");
let b1 = &s;
let b2 = &s;
println!("{}, {}", b1, b2);

// ✅ Correct - multiple immutable borrows are fine!
```

### 2. Forgetting 'mut'

```rust
// ❌ Can't push to Vec without mut
let mut vec = Vec::new();
vec.push(1);  // Needs 'mut'

// ✅ Correct
```

### 3. Panic vs Error

```rust
// ❌ Avoid panics in production code
let value: i32 = String::from("hello").parse().unwrap();  // Panics!

// ✅ Handle errors properly
let result: Result<i32, _> = String::from("hello").parse();
match result {
    Ok(v) => println!("{}", v),
    Err(e) => { /* handle gracefully */ }
}
```

### 4. Using &String vs String

```rust
// ❌ String takes ownership, &str is a reference
let s = String::from("hello");
let r = &s;  // &str, not owned

// ✅ Use &str in most cases
```

---

## Summary Checklist

After each section, check off what you've learned:

- [ ] Install Rust and Cargo
- [ ] Write Hello World
- [ ] Understand type system (immutability)
- [ ] Master ownership and borrowing
- [ ] Understand stack vs heap
- [ ] Handle errors with Result/Option
- [ ] Use traits for interfaces
- [ ] Create modules and crates
- [ ] Write tests with cargo test
- [ ] Work with generics
- [ ] Use iterators
- [ ] Understand pattern matching

---

## Next Steps

1. **Build a small project** - CLI tool, calculator, or data processor
2. **Read "The Book"** - Chapters 4-10 for core concepts
3. **Contribute to Rust** - Start with documentation or small PRs
4. **Explore async** - Tokio runtime for async Rust
5. **Join community** - Discord, forums, local meetups

---

## About This Tutorial

This tutorial was created for JavaScript/TypeScript developers transitioning to Rust, focusing on connecting concepts you already know with Rust's unique approach to systems programming and memory management.

**Happy Coding! 🦀**

---
