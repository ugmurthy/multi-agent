# Rust Tutorial for Intermediate JavaScript/TypeScript Programmers

Welcome to this Rust tutorial designed specifically for intermediate JavaScript/TypeScript developers. This guide will help you leverage your existing JS/TS knowledge while learning Rust's unique features and paradigms.

## Table of Contents

1. **Introduction to Rust for JS/TS Developers**
   - Why Learn Rust?
   - Rust vs JavaScript/TypeScript: Key Differences
   - Setting Up Your Rust Environment

2. **Rust Fundamentals**
   - Variables and Mutability
   - Data Types
   - Functions
   - Comments
   - Control Flow

3. **Ownership and Borrowing**
   - Understanding Ownership
   - References and Borrowing
   - Slices

4. **Structs and Enums**
   - Defining and Using Structs
   - Enums and Pattern Matching
   - Option and Result Types

5. **Error Handling**
   - Panics vs Proper Error Handling
   - Using Result for Error Propagation
   - Custom Error Types

6. **Collections**
   - Vectors
   - Strings
   - Hash Maps

7. **Concurrency in Rust**
   - Threads
   - Message Passing
   - Shared State

8. **Rust's Type System**
   - Generics
   - Traits
   - Lifetimes

9. **Testing in Rust**
   - Writing Tests
   - Test Organization
   - Integration Tests

10. **Rust Tooling and Ecosystem**
    - Cargo: Rust's Package Manager
    - Documentation
    - Popular Crates

11. **Transitioning from JS/TS to Rust**
    - Common Pitfalls
    - Performance Considerations
    - When to Use Rust vs JS/TS

12. **Building a Project: TODO API**
    - Project Setup
    - Implementing CRUD Operations
    - Error Handling
    - Testing

13. **Next Steps and Resources**
    - Books
    - Online Courses
    - Community Resources

## 1. Introduction to Rust for JS/TS Developers

### Why Learn Rust?

Rust is a systems programming language that runs blazingly fast, prevents segfaults, and guarantees thread safety. As a JavaScript/TypeScript developer, learning Rust will:

- Expand your understanding of systems programming
- Improve your ability to write performant code
- Introduce you to compile-time guarantees for memory safety
- Enhance your problem-solving skills with a different paradigm

### Rust vs JavaScript/TypeScript: Key Differences

| Feature          | JavaScript/TypeScript | Rust                  |
|------------------|-----------------------|-----------------------|
| Typing           | Dynamic/Duck typing    | Static, strong typing  |
| Memory Management| Garbage Collected      | Ownership model       |
| Concurrency      | Event loop             | Fearless concurrency   |
| Compilation      | JIT/Transpiled         | Ahead-of-time compiled |
| Null Handling    | null/undefined         | Option/Result types    |
| Error Handling   | Exceptions/try-catch   | Result type           |

### Setting Up Your Rust Environment

1. Install Rust using rustup:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```

2. Verify installation:
   ```bash
   rustc --version
   cargo --version
   ```

3. Update Rust:
   ```bash
   rustup update
   ```

4. (Optional) Install an IDE with Rust support (VS Code with rust-analyzer recommended)

## 2. Rust Fundamentals

### Variables and Mutability

In Rust, variables are immutable by default, unlike JavaScript where variables declared with `let` can be reassigned.

```rust
// Immutable variable
let x = 5;
x = 6; // Error: cannot assign twice to immutable variable

// Mutable variable
let mut y = 5;
y = 6; // OK
```

This is similar to TypeScript's `const` vs `let`, but Rust enforces this at compile time.

### Data Types

Rust is statically typed, meaning types must be known at compile time. The compiler can usually infer types, but you can also specify them.

#### Scalar Types
- Integers: `i8`, `i16`, `i32`, `i64`, `i128`, `isize` (signed)
- Unsigned integers: `u8`, `u16`, `u32`, `u64`, `u128`, `usize`
- Floating-point: `f32`, `f64`
- Boolean: `bool`
- Character: `char` (4 bytes, Unicode)

#### Compound Types
- Tuples: Fixed-size, mixed types
- Arrays: Fixed-size, same type

```rust
// Tuple
let tuple: (i32, f64, u8) = (500, 6.4, 1);

// Array
let array: [i32; 5] = [1, 2, 3, 4, 5];
```

### Functions

Function declarations in Rust are similar to JavaScript but with type annotations.

```rust
fn add(a: i32, b: i32) -> i32 {
    a + b // No semicolon means this is the return value
}
```

Key differences from JS/TS:
- Type annotations required for parameters
- Return type specified with `->`
- Last expression in a function is automatically returned (no `return` keyword needed unless early return)

### Comments

Comments in Rust are similar to JavaScript:

```rust
// Line comment

/*
 * Block comment
 */
```

### Control Flow

#### If Expressions

```rust
let number = 3;

if number < 5 {
    println!("condition was true");
} else {
    println!("condition was false");
}
```

Unlike JavaScript, Rust's `if` is an expression that can return a value:

```rust
let condition = true;
let number = if condition { 5 } else { 6 };
```

#### Loops

Rust has three kinds of loops: `loop`, `while`, and `for`.

```rust
// Infinite loop
loop {
    println!("again!");
    break; // Exit the loop
}

// While loop
while number != 0 {
    println!("{}", number);
    number -= 1;
}

// For loop
for element in array.iter() {
    println!("{}", element);
}
```

## 3. Ownership and Borrowing

Ownership is Rust's most unique feature and the key to its memory safety guarantees.

### Understanding Ownership

1. Each value in Rust has a variable called its owner.
2. There can only be one owner at a time.
3. When the owner goes out of scope, the value is dropped.

```rust
let s1 = String::from("hello");
let s2 = s1; // s1 is no longer valid (move occurs)

println!("{}", s1); // Error: value borrowed here after move
```

### References and Borrowing

Instead of transferring ownership, we can borrow references:

```rust
let s1 = String::from("hello");
let len = calculate_length(&s1); // Pass a reference

fn calculate_length(s: &String) -> usize {
    s.len()
}
```

Rules of references:
1. You can have either one mutable reference or any number of immutable references
2. References must always be valid

### Slices

Slices let you reference a contiguous sequence of elements in a collection.

```rust
let s = String::from("hello world");
let hello = &s[0..5];
let world = &s[6..11];
```

## 4. Structs and Enums

### Defining and Using Structs

Structs are similar to objects in JavaScript but with a fixed structure.

```rust
struct User {
    username: String,
    email: String,
    sign_in_count: u64,
    active: bool,
}

let user1 = User {
    email: String::from("someone@example.com"),
    username: String::from("someusername123"),
    active: true,
    sign_in_count: 1,
};
```

### Enums and Pattern Matching

Enums allow you to define a type by enumerating its possible variants.

```rust
enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
    ChangeColor(i32, i32, i32),
}
```

Pattern matching with `match`:

```rust
fn process_message(msg: Message) {
    match msg {
        Message::Quit => println!("Quit"),
        Message::Move { x, y } => println!("Move to {}, {}", x, y),
        Message::Write(text) => println!("Text message: {}", text),
        Message::ChangeColor(r, g, b) => println!("Change color to RGB({}, {}, {})", r, g, b),
    }
}
```

### Option and Result Types

Rust doesn't have null, but has `Option<T>` for values that might be absent:

```rust
enum Option<T> {
    Some(T),
    None,
}
```

`Result<T, E>` is used for operations that might fail:

```rust
enum Result<T, E> {
    Ok(T),
    Err(E),
}
```

## 5. Error Handling

### Panics vs Proper Error Handling

Rust has two categories of error handling:
1. Unrecoverable errors with `panic!` macro
2. Recoverable errors with `Result`

```rust
// Unrecoverable
panic!("This will crash the program");

// Recoverable
let result: Result<i32, &str> = Ok(42);
```

### Using Result for Error Propagation

The `?` operator makes error propagation more ergonomic:

```rust
fn read_file(path: &str) -> Result<String, std::io::Error> {
    let mut file = std::fs::File::open(path)?;
    let mut contents = String::new();
    file.read_to_string(&mut contents)?;
    Ok(contents)
}
```

### Custom Error Types

You can define your own error types:

```rust
#[derive(Debug)]
enum AppError {
    Io(std::io::Error),
    Parse(std::num::ParseIntError),
    Validation(String),
}
```

## 6. Collections

### Vectors

Vectors are similar to JavaScript arrays but with more type safety.

```rust
let v: Vec<i32> = Vec::new();
let v = vec![1, 2, 3]; // Macro to create with initial values
```

### Strings

Rust's `String` type is UTF-8 encoded and growable.

```rust
let mut s = String::from("hello");
s.push_str(", world!");
```

### Hash Maps

```rust
use std::collections::HashMap;

let mut scores = HashMap::new();
scores.insert(String::from("Blue"), 10);
```

## 7. Concurrency in Rust

Rust's concurrency model prevents data races at compile time.

### Threads

```rust
use std::thread;

thread::spawn(|| {
    println!("Hello from a thread!");
});
```

### Message Passing

```rust
use std::sync::mpsc;

let (tx, rx) = mpsc::channel();
tx.send(42).unwrap();
let received = rx.recv().unwrap();
```

### Shared State

```rust
use std::sync::{Arc, Mutex};

let counter = Arc::new(Mutex::new(0));
```

## 8. Rust's Type System

### Generics

Generics allow you to define functions, structs, enums, and methods with placeholders for types.

```rust
fn largest<T: PartialOrd>(list: &[T]) -> &T {
    let mut largest = &list[0];
    for item in list {
        if item > largest {
            largest = item;
        }
    }
    largest
}
```

### Traits

Traits are similar to interfaces in TypeScript.

```rust
pub trait Summary {
    fn summarize(&self) -> String;
}
```

### Lifetimes

Lifetimes ensure that references are always valid.

```rust
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}
```

## 9. Testing in Rust

Rust has built-in test support.

### Writing Tests

```rust
#[test]
fn it_works() {
    assert_eq!(2 + 2, 4);
}
```

### Test Organization

Tests are typically placed in a `tests` module.

### Integration Tests

Integration tests go in the `tests` directory at the root of your project.

## 10. Rust Tooling and Ecosystem

### Cargo: Rust's Package Manager

Cargo handles building, testing, and dependency management.

```toml
# Cargo.toml
[package]
name = "my-project"
version = "0.1.0"

[dependencies]
serde = "1.0"
```

### Documentation

Generate documentation with:
```bash
cargo doc --open
```

### Popular Crates

- `serde`: Serialization framework
- `tokio`: Async runtime
- `actix-web`: Web framework
- `diesel`: ORM

## 11. Transitioning from JS/TS to Rust

### Common Pitfalls

1. Fighting the borrow checker
2. Overusing `clone()`
3. Not leveraging the type system enough
4. Trying to write Rust like JavaScript

### Performance Considerations

- Rust gives you fine-grained control over performance
- Zero-cost abstractions mean you don't pay for what you don't use
- Memory is managed without a garbage collector

### When to Use Rust vs JS/TS

| Use Rust when...          | Use JS/TS when...          |
|---------------------------|-----------------------------|
| You need performance       | You need rapid development  |
| Building system tools      | Building web applications   |
| Memory safety is critical  | You need a large ecosystem  |
| Parallel processing        | You need to run in browsers  |

## 12. Building a Project: TODO API

Let's build a simple TODO API to practice Rust concepts.

### Project Setup

```bash
cargo new todo-api
cd todo-api
```

Add dependencies to `Cargo.toml`:
```toml
[dependencies]
actix-web = "4"
serde = { version = "1.0", features = ["derive"] }
```

### Implementing CRUD Operations

```rust
use actix_web::{web, App, HttpServer, Responder};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
struct Todo {
    id: u32,
    title: String,
    completed: bool,
}

struct AppState {
    todos: Vec<Todo>,
}

async fn get_todos(data: web::Data<AppState>) -> impl Responder {
    web::Json(&data.todos)
}

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    let app_state = web::Data::new(AppState {
        todos: vec![
            Todo {
                id: 1,
                title: "Learn Rust".to_string(),
                completed: false,
            },
        ],
    });

    HttpServer::new(move || {
        App::new()
            .app_data(app_state.clone())
            .route("/todos", web::get().to(get_todos))
    })
    .bind("127.0.0.1:8080")?
    .run()
    .await
}
```

### Error Handling

Add proper error handling with custom error types.

### Testing

Write unit tests for your API functions and integration tests for the endpoints.

## 13. Next Steps and Resources

### Books
- "The Rust Programming Language" (The official book)
- "Rust for Rustaceans"
- "Programming Rust"

### Online Courses
- Rust by Example
- Rustlings (small exercises)
- Tour of Rust

### Community Resources
- Rust subreddit
- Rust Discord
- Rust forum

## Conclusion

This tutorial has introduced you to Rust's core concepts from the perspective of a JavaScript/TypeScript developer. The key to mastering Rust is:

1. Embrace the borrow checker - it's your friend
2. Leverage the type system for correctness
3. Think in terms of ownership and borrowing
4. Practice with small projects

Rust offers a unique combination of performance, safety, and expressiveness. As you continue your journey, you'll discover how these features enable you to write more reliable and efficient code than you might have thought possible.

Happy coding in Rust! 🦀