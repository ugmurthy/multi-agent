# Rust Tutorial for Intermediate JavaScript/TypeScript Developers

This tutorial is designed for developers with intermediate experience in JavaScript or TypeScript. You'll leverage your knowledge of concepts like variables, functions, objects, classes, async/await, modules, and closures to learn Rust faster. Rust is a systems programming language focused on safety, speed, and concurrency. Unlike JS/TS's garbage-collected memory model, Rust uses **ownership** to prevent common bugs like null pointers and data races—at compile time!

We'll compare Rust concepts to JS/TS equivalents throughout. Each section includes:
- **Explanation** with JS/TS analogies.
- **Code examples**.
- **Exercises** for hands-on practice.

**Prerequisites**: Node.js experience, basic command-line usage.

## 1. Installation and Setup

### Install Rust
1. Visit [rustup.rs](https://rustup.rs/) and run the installer:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
2. Restart your shell and verify:
   ```bash
   rustc --version
   cargo --version
   ```
   - `rustc`: Rust compiler.
   - `cargo`: Package manager/build tool (like npm/yarn).

**JS/TS Analogy**: Like installing Node.js + npm.

### Create a New Project
```bash
cargo new hello_rust
cd hello_rust
```
This creates `Cargo.toml` (like `package.json`) and `src/main.rs` (entry point).

## 2. Hello World

Edit `src/main.rs`:
```rust
fn main() {
    println!("Hello, Rustaceans from JS/TS world!");
}
```
Run:
```bash
cargo run
```

**JS/TS Analogy**: `console.log()` in a script.

**Exercise**: Modify to print your name.

## 3. Variables and Mutability

Variables are **immutable** by default (no accidental reassignments like in JS).

```rust
fn main() {
    let x = 5;  // Immutable, inferred type i32
    println!("x: {}", x);

    let mut y = 10;  // Mutable with 'mut'
    y = 15;
    println!("y: {}", y);
}
```

- Types: `i32` (int), `f64` (float), `bool`, `char`.
- No `var/let/const` wars—`let` is default immutable, `mut` for mutable.

**JS/TS Analogy**: `const` vs `let`. Rust enforces `const`-like safety.

**Shadowing**: Rebind with same name:
```rust
let z = 5;
let z = z + 1;  // New z, shadows old
let z = z * 2;  // Shadow again
```

**Exercise**: Write a function to swap two mutable vars without a temp (use shadowing).

## 4. Functions

Defined with `fn`, explicit types:
```rust
fn add(a: i32, b: i32) -> i32 {
    a + b  // No semicolon = return value
}

fn main() {
    let sum = add(3, 4);
    println!("Sum: {}", sum);
}
```

- Functions return the last expression (no `return` unless early).
- **JS/TS Analogy**: Arrow functions, but types are required (like TS).

**Exercise**: Write a `greet` function taking `&str` (string slice) and returning formatted string.

## 5. Control Flow

### If/Else
```rust
let num = 5;
let desc = if num > 0 { "positive" } else { "non-positive" };
```

**JS/TS Analogy**: Ternary `condition ? true : false`, but `if` can assign.

### Loop
```rust
let mut counter = 0;
let result = loop {
    counter += 1;
    if counter == 10 { break counter * 2; }
};
```

### While/For
```rust
let a = [10, 20, 30];
for element in a.iter() {
    println!("{}", element);
}
```

**JS/TS Analogy**: `for...of`, `while`.

**Exercise**: FizzBuzz using `loop`.

## 6. Ownership – Rust's Superpower

Rust's ownership rules prevent memory bugs:
1. Each value has one owner.
2. When owner goes out of scope, value drops.
3. No GC—compile-time checks.

```rust
fn main() {
    let s1 = String::from("hello");  // s1 owns the string
    let s2 = s1;  // Ownership moves to s2, s1 invalid!
    // println!("{}", s1);  // Compile error!
    println!("{}", s2);
}
```

**JS/TS Analogy**: No direct equivalent—JS copies references, but Rust *moves* ownership to avoid shared mutable state issues.

**String Types**:
- `String`: Owned, growable (like `let s = new String()`).
- `&str`: String slice, borrow (like `const s: string = "hello"`).

## 7. Borrowing and References

Borrow instead of moving:
```rust
fn longest(x: &str, y: &str) -> &str {  // Borrows
    if x.len() > y.len() { x } else { y }
}

fn main() {
    let s1 = String::from("long");
    let result = longest(&s1, "short");  // & borrows
    println!("Longest: {}", result);     // Valid, borrow ends
}
```

Rules:
- One mutable borrow OR multiple immutable.
- No nesting mutables.

**JS/TS Analogy**: References, but JS allows aliasing mutable objects freely (races in concurrency).

**Exercise**: Implement `calculate_length` that takes `&String` → `usize`.

## 8. Structs – Custom Types

Like TS classes/objects:
```rust
struct Person {
    name: String,
    age: u32,
}

fn main() {
    let p = Person {
        name: String::from("Alice"),
        age: 30,
    };
    println!("{} is {}", p.name, p.age);
}
```

**Methods**:
```rust
impl Person {
    fn greet(&self) -> String {  // &self borrows
        format!("Hi, I'm {}!", self.name)
    }
}
```

**JS/TS Analogy**: Classes with `this`.

**Exercise**: Define `Rectangle`, add `area` method.

## 9. Enums and Pattern Matching

Enums are algebraic data types:
```rust
enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
}

fn main() {
    let m = Message::Write(String::from("hello"));
    match m {
        Message::Quit => println!("Quit"),
        Message::Move { x, y } => println!("Move to {},{}", x, y),
        Message::Write(s) => println!("Write: {}", s),
    }
}
```

**JS/TS Analogy**: Union types `string | number`, discriminated unions.

`Option<T>` / `Result<T,E>` replace `null`/`undefined`.
```rust
fn divide(a: f64, b: f64) -> Result<f64, String> {
    if b == 0.0 { Err("Division by zero".to_string()) }
    else { Ok(a / b) }
}
```

**Exercise**: Parse IP address with `Result`.

## 10. Error Handling

No exceptions—use `Result`/`Option`.
```rust
use std::fs::File;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let f = File::open("hello.txt")?;  // ? propagates error
    Ok(())
}
```

**JS/TS Analogy**: `try/catch` → `if let Err(e) = func() { ... }` or `?`.

**Exercise**: Read file contents safely.

## 11. Collections

- `Vec<T>`: Growable array (like `Array`).
```rust
let mut v: Vec<i32> = Vec::new();
v.push(1);
```
- `HashMap<K,V>`: Like `Map`/`Object`.

Iterate:
```rust
for (i, &num) in v.iter().enumerate() { ... }
```

**JS/TS Analogy**: Arrays, Maps.

## 12. Strings – Tricky!

Strings are UTF-8 bytes. `&str` vs `String`.
```rust
let s = "hello";  // &str
let owned = s.to_string();  // String
```

**Exercise**: Reverse a string.

## 13. Modules and Crates

`mod` for files:
```rust
// src/lib.rs or mod.rs
pub fn public() {}
```

`Cargo.toml` dependencies:
```toml
[dependencies]
serde = "1.0"
```

**JS/TS Analogy**: `import/export`, npm.

## 14. Generics and Traits

**Generics**: Like TS generics.
```rust
fn largest<T: PartialOrd>(a: &T, b: &T) -> &T { ... }
```

**Traits**: Interfaces/protocols.
```rust
pub trait Summary {
    fn summarize(&self) -> String;
}
```

**JS/TS Analogy**: Interfaces, duck typing.

**Exercise**: Implement `Display` for a struct.

## 15. Concurrency Basics

**Threads**:
```rust
use std::thread;

let handle = thread::spawn(|| {
    println!("Hello from thread!");
});
handle.join().unwrap();
```

**Channels** for communication (like event emitters).

**JS/TS Analogy**: Workers, but safe—no races.

## 16. Lifetimes (Advanced Peek)

`'a` annotation for borrows:
```rust
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str { x }
```

Compiler infers most.

## Next Steps

- [Rust Book](https://doc.rust-lang.org/book/)
- Build CLI tool with `clap`.
- WebAssembly for JS interop.
- [Rustlings](https://github.com/rust-lang/rustlings) exercises.

Practice daily! Rust's borrow checker is strict but teaches safe code.

**Happy Rusting! 🚀**
