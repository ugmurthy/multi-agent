# Rust Tutorial for Intermediate JavaScript/TypeScript Developers

This tutorial is designed for developers with intermediate knowledge of JavaScript or TypeScript. We'll leverage your existing understanding of concepts like variables, functions, objects, async code, and modules to bridge the gap to Rust. Rust emphasizes **memory safety**, **performance**, and **concurrency** without a garbage collector (GC), using an **ownership model** instead.

Rust compiles to native code, making it blazing fast—like Node.js but without the V8 overhead. Popular in web (WASM), systems, and backend (e.g., Deno internals, AWS Lambda runtimes).

**Prerequisites**: Comfortable with JS/TS, npm/yarn, command line.

## Table of Contents
- [Installation](#installation)
- [Hello World](#hello-world)
- [Variables and Mutability](#variables-and-mutability)
- [Data Types](#data-types)
- [Functions](#functions)
- [Control Flow](#control-flow)
- [Ownership](#ownership) *(Rust's killer feature)*
- [References and Borrowing](#references-and-borrowing)
- [Structs and Methods](#structs-and-methods)
- [Enums and Pattern Matching](#enums-and-pattern-matching)
- [Common Collections](#common-collections)
- [Error Handling](#error-handling)
- [Traits and Generics](#traits-and-generics)
- [Modules and Crates](#modules-and-crates)
- [Testing](#testing)
- [Practical Project: Guessing Game](#practical-project-guessing-game)
- [Next Steps](#next-steps)

## Installation
1. Install [rustup](https://rustup.rs/) (Rust toolchain manager):
   ```
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source ~/.cargo/env
   ```
2. Verify: `rustc --version` and `cargo --version`.
   - `rustc`: Compiler
   - `cargo`: Build tool/package manager (like npm)

**Editor**: VS Code with `rust-analyzer` extension.

## Hello World
Create `hello.rs`:
```rust
fn main() {
    println!("Hello, Rustaceans!");
}
```
Run: `rustc hello.rs && ./hello` (or use Cargo below).

With **Cargo** (recommended, like `npm init`):
```
cargo new hello_cargo
cd hello_cargo
cargo run
```
`Cargo.toml` is like `package.json`.

**JS Analogy**: `console.log` → `println!` macro. `main()` like Node's entry point.

## Variables and Mutability
```rust
let x = 5;     // Immutable by default (like TS `const`)
let mut y = 10; // Mutable (reassignable)
y = 15;

// Shadowing (redeclare in same scope)
let z = 20;
let z = z + 1; // Now z=21 (different type possible!)
```
**JS/TS**: `let`/`const` but immutable-first. No `var` hoisting mess. Shadowing > reassignment for clarity.

## Data Types
**Primitives** (stack-allocated, fast):
- Integers: `i32` (default, like Number.isSafeInteger), `i64`, `u32`
- Float: `f64`
- `bool`, `char` (single Unicode)

```rust
let guess: u32 = "42".parse().expect("Not a number!"); // Type annotation
```
**Strings**:
- `&str`: String slice (immutable view, like `string` literal)
- `String`: Owned, growable (like `new String()` but efficient)

```rust
let hello = "Hello";     // &str
let mut hello_owned = String::from("Hello"); // String
hello_owned.push_str(", World!");
```

**JS Analogy**: Primitives immutable like JS primitives. Objects/arrays mutable. But Rust strings are explicit.

## Functions
```rust
fn add(a: i32, b: i32) -> i32 { // Return type after ->
    a + b // No semicolon = return (last expr)
}

fn main() {
    let sum = add(5, 3);
    println!("Sum: {}", sum); // {} placeholders
}
```
**JS/TS**: `function add(a: number, b: number): number { return a + b; }`. Expressions over statements.

## Control Flow
**If** (expression!):
```rust
let number = 7;
let desc = if number < 5 { "small" } else { "big" }; // Type must match
```
**Loops**:
```rust
// loop (infinite, breaks)
let mut counter = 0;
let result = loop {
    counter += 1;
    if counter == 10 { break counter * 2; }
};

// while
while counter != 0 {
    counter -= 1;
}

// for (iterates collections)
for i in 1..=5 { // 1 to 5 incl.
    println!("{}", i);
}
```
**Match** (exhaustive `switch`):
```rust
match day {
    1 => println!("Monday"),
    2..=5 => println!("Weekday"),
    _ => println!("Weekend"), // Catch-all
}
```
**JS/TS**: `if/else`, `for/of`, `switch` but non-exhaustive. Match catches errors at compile-time.

## Ownership
Rust's core: **Each value has a single owner**. Owner drops value at end of scope (no GC!).

```rust
let s1 = String::from("hello"); // s1 owns
let s2 = s1; // Move: s1 invalid now!
// println!("{}", s1); // Error! Use after move

// But primitives copy (Copy trait)
let x = 5;
let y = x; // OK, copy
```
**JS Analogy**: JS GC tracks refs; multiple vars can point to same object. Rust prevents shared mutable state bugs at compile-time. Like `Object.assign` but enforced.

Rules:
1. Move on assign
2. Clone for copies (`s2 = s1.clone();`)
3. Functions take ownership: `fn takes_owner(s: String)` moves it.

## References and Borrowing
Share without moving: `&` (borrow).
```rust
fn len(s: &String) -> usize { s.len() } // Borrow

let s1 = String::from("hello");
let len = len(&s1); // Borrow, s1 still valid
```
**Borrow Rules** (compiler enforces):
- One mutable borrow (`&mut`) OR many immutable (`&`)
- No borrow after drop
- No mut while immutable borrowed

Lifetimes `'a` ensure refs outlive data (advanced).

**JS Analogy**: Like passing object refs, but no mutation races.

## Structs and Methods
```rust
struct Point {
    x: i32,
    y: i32,
}

impl Point { // Like class methods
    fn new(x: i32, y: i32) -> Point {
        Point { x, y }
    }
    fn area(&self) -> i32 { self.x * self.y }
}

let p = Point::new(3, 4);
```
**JS/TS**: `{ x: 3, y: 4 }` → `class Point { constructor(x,y){} area(){ return this.x*this.y; } }`.

## Enums and Pattern Matching
```rust
enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
}

fn process(msg: Message) {
    match msg {
        Message::Quit => println!("Quit"),
        Message::Move { x, y } => println!("Move to {},{}", x, y),
        Message::Write(s) => println!("{}", s),
    }
}
```
**JS/TS**: Union types `type Msg = 'Quit' | {type: 'Move', x: number, y: number} | {type: 'Write', text: string}` + type guards.

## Common Collections
From `std::collections`:
```rust
use std::collections::HashMap;

let mut scores = HashMap::new();
scores.insert(String::from("Blue"), 10);

// Vec<T>
let mut v: Vec<i32> = vec![1,2,3];
v.push(4);
for i in &v { println!("{}", i); }
```
**JS/TS**: `Array`, `Map/Set`.

## Error Handling
No exceptions: `Option<T>` (Some/None), `Result<T,E>` (Ok/Err).

```rust
fn divide(a: f64, b: f64) -> Result<f64, String> {
    if b == 0.0 { Err("Division by zero".to_string()) }
    else { Ok(a / b) }
}

match divide(10.0, 0.0) {
    Ok(res) => println!("Result: {}", res),
    Err(e) => println!("Error: {}", e),
}

// ? propagates errors (like try-catch)
fn maybe_divide() -> Result<f64, String> {
    let res = divide(10.0, 2.0)?;
    Ok(res)
}
```
**JS/TS**: `null/undefined` → `Option`. `try/catch` → `Result` + `?`.

## Traits and Generics
**Traits**: Like interfaces/protocols.
```rust
trait Summary {
    fn summarize(&self) -> String;
}

struct Article { /* ... */ }
impl Summary for Article {
    fn summarize(&self) -> String { /* ... */ }
}
```
**Generics**: `<T>`
```rust
fn largest<T: PartialOrd>(list: &[T]) -> &T { /* ... */ }
```
**JS/TS**: Interfaces, generics.

## Modules and Crates
`Cargo.toml`:
```toml
[package]
name = "myapp"
[dependencies]
serde = "1.0"
```
`mod.rs` or `lib.rs`. `pub` for public, `use`/`mod`.

**JS**: ES modules/`package.json`.

`cargo add serde` like `npm i`.

## Testing
```rust
#[cfg(test)]
mod tests {
    #[test]
    fn it_works() {
        assert_eq!(2 + 2, 4);
    }
}
```
`cargo test`.

## Practical Project: Guessing Game
1. `cargo new guess_game`
2. Edit `src/main.rs`:
```rust
use std::io;
use rand::Rng;
use std::cmp::Ordering;

fn main() {
    let secret = rand::thread_rng().gen_range(1..=100);
    println!("Guess a number 1-100");

    loop {
        let mut guess = String::new();
        io::stdin().read_line(&mut guess).expect("Failed");
        let guess: u32 = guess.trim().parse().expect("Number pls");

        println!("You guessed: {}", guess);
        match guess.cmp(&secret) {
            Ordering::Less => println!("Too small!"),
            Ordering::Greater => println!("Too big!"),
            Ordering::Equal => {
                println!("You win!");
                break;
            }
        }
    }
}
```
3. `Cargo.toml`: Add `rand = \"0.8\"`
4. `cargo run`

**Extensions**: Input validation, multiple guesses.

## Next Steps
- Read [The Rust Book](https://doc.rust-lang.org/book/)
- [Rustlings](https://github.com/rust-lang/rustlings) exercises
- Build CLI with `clap`, web with `axum`/`actix-web`
- WASM for browser (Yew/Leptos)
- [Comprehensive Rust (Google)](https://github.com/google/comprehensive-rust)
- JS-specific: [Rust for JS Devs](https://rustforjsdevs.com/)

Practice daily—Rust's borrow checker is strict but teaches safe code. Happy Rusting! 🦀