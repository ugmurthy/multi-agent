# Rust Tutorial for JavaScript/TypeScript Developers

> A comprehensive guide to learn Rust, designed specifically for intermediate JS/TS programmers.

---

## Table of Contents

1. [Introduction: Why Rust?](#1-introduction-why-rust)
2. [Getting Started](#2-getting-started)
3. [Core Concepts: The Mental Model Shift](#3-core-concepts-the-mental-model-shift)
4. [Variables and Data Types](#4-variables-and-data-types)
5. [Functions and Control Flow](#5-functions-and-control-flow)
6. [Ownership, Borrowing, and Lifetimes](#6-ownership-borrowing-and-lifetimes)
7. [Structs and Enums](#7-structs-and-enums)
8. [Error Handling](#8-error-handling)
9. [Modules and Crates](#9-modules-and-crates)
10. [Traits and Generics](#10-traits-and-generics)
11. [Smart Pointers and Memory Management](#11-smart-pointers-and-memory-management)
12. [Concurrency](#12-concurrency)
13. [Async/await in Rust](#13-asyncawait-in-rust)
14. [Working with External APIs](#14-working-with-external-apis)
15. [Testing](#15-testing)
16. [Build Tools and Ecosystem](#16-build-tools-and-ecosystem)
17. [Best Practices and Common Pitfalls](#17-best-practices-and-common-pitfalls)
18. [Next Steps and Resources](#18-next-steps-and-resources)

---

## 1. Introduction: Why Rust?

### 1.1 What Makes Rust Different?

| Feature | JavaScript/TypeScript | Rust |
|---------|----------------------|------|
| **Memory Management** | Garbage Collected | Manual (but safe) |
| **Compilation** | Interpreted/JIT | AOT Compiled |
| **Type System** | Dynamic/Optional Static | Static, Strict |
| **Null Safety** | Runtime errors possible | Compile-time prevention |
| **Concurrency** | Event Loop | Native Threads + Channels |
| **Performance** | Variable | Near C/C++ |

### 1.2 Key Benefits for JS/TS Developers

- **No Runtime Surprises**: Catch errors at compile time, not runtime
- **Zero-Cost Abstractions**: High-level code with low-level performance
- **Memory Safety Without GC**: No garbage collection pauses
- **Fearless Concurrency**: Data races prevented at compile time
- **Great Tooling**: Built-in package manager, formatter, linter

### 1.3 What You'll Learn

This tutorial assumes you understand:
- Variables, functions, and control flow
- Object-oriented and functional programming concepts
- Asynchronous programming patterns
- Type systems (from TypeScript)

---

## 2. Getting Started

### 2.1 Installation

```bash
# Install Rust via rustup (recommended)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Verify installation
rustc --version
cargo --version
```

### 2.2 Project Structure

```bash
# Create a new project
cargo new my_project
cd my_project

# Project structure:
# my_project/
# ├── Cargo.toml      # Package manifest (like package.json)
# └── src/
#     └── main.rs     # Entry point (like index.js)
```

### 2.3 Your First Program

```rust
// src/main.rs
fn main() {
    println!("Hello, world!");
}

// Run it
cargo run
```

### 2.4 Key Commands

```bash
cargo run           # Build and run
cargo build         # Build only
cargo test          # Run tests
cargo check         # Check without building
cargo fmt           # Format code
cargo clippy        # Linting
cargo doc           # Generate documentation
```

---

## 3. Core Concepts: The Mental Model Shift

### 3.1 The Ownership Model

**JavaScript:**
```javascript
let a = { value: 42 };
let b = a;  // b references the same object
b.value = 100;
console.log(a.value); // 100 - modified!
```

**Rust:**
```rust
let a = String::from("hello");
let b = a;  // b TAKES OWNERSHIP of a
// println!("{}", a); // ERROR: a is no longer valid!
println!("{}", b);  // OK
```

**Why?** Rust prevents:
- Use-after-free errors
- Double-free errors
- Data races in concurrent code

### 3.2 Copy vs Move

```rust
// i32 is Copy - both variables own the value
let x = 5;
let y = x;
println!("x = {}, y = {}", x, y); // x = 5, y = 5

// String is not Copy - ownership transfers
let s1 = String::from("hello");
let s2 = s1;
// println!("{}", s1); // ERROR: use after move
```

### 3.3 Clone for Deep Copies

```rust
let s1 = String::from("hello");
let s2 = s1.clone();  // Explicit deep copy
println!("s1 = {}, s2 = {}", s1, s2);
```

### 3.4 Exercise 1

```rust
// Fix this code:
fn main() {
    let data = String::from("important");
    let backup = data;
    println!("Original: {}", data);
    println!("Backup: {}", backup);
}
```

<details>
<summary>Solution</summary>

```rust
fn main() {
    let data = String::from("important");
    let backup = data.clone();  // Clone instead of move
    println!("Original: {}", data);
    println!("Backup: {}", backup);
}
```
</details>

---

## 4. Variables and Data Types

### 4.1 Variable Binding

```rust
// Immutable by default (like const in JS)
let x = 5;
// x = 6; // ERROR: cannot assign twice

// Mutable variables
let mut y = 5;
y = 6; // OK

// Shadowing (redeclare with same name)
let x = 5;
let x = x + 1;  // OK - new binding
let x = "hello"; // OK - different type!
```

### 4.2 Basic Types

```rust
// Integers
let x: i32 = 42;        // 32-bit signed (default)
let y: u64 = 42;        // 64-bit unsigned
let z: i8 = 42;         // 8-bit signed

// Floats
let pi: f64 = 3.14;     // 64-bit (default)
let e: f32 = 2.718;     // 32-bit

// Boolean
let is_true: bool = true;
let is_false: bool = false;

// Character
let c: char = 'A';      // Unicode scalar value

// String slice (borrowed)
let s: &str = "hello";

// Owned String
let s: String = String::from("hello");
```

### 4.3 Tuples and Arrays

```rust
// Tuples (fixed-size, heterogeneous)
let tuple: (i32, &str, bool) = (5, "hello", true);
let (x, y, z) = tuple;  // Destructuring

// Arrays (fixed-size, homogeneous)
let arr: [i32; 5] = [1, 2, 3, 4, 5];
let first = arr[0];     // Access element

// Slice (view into array)
let slice: &[i32] = &arr[1..4]; // [2, 3, 4]
```

### 4.4 Type Inference

```rust
// Rust infers types (like TypeScript)
let x = 5;              // i32
let s = "hello";        // &str
let pi = 3.14;          // f64

// Explicit annotation when needed
let explicit: i32 = 5;
```

---

## 5. Functions and Control Flow

### 5.1 Function Syntax

```rust
// Basic function
fn add(a: i32, b: i32) -> i32 {
    a + b
}

// With return keyword
fn greet(name: &str) -> String {
    return format!("Hello, {}!", name);
}

// No return value (returns ())
fn print_message(msg: &str) {
    println!("{}", msg);
}

// Diverging function (never returns)
fn panic_if_negative(x: i32) {
    if x < 0 {
        panic!("Negative value!");
    }
}
```

### 5.2 Control Flow

```rust
// If/else (expressions, not statements!)
let x = 5;
let description = if x > 10 {
    "big"
} else if x > 5 {
    "medium"
} else {
    "small"
};

// Loops
loop {
    // Infinite loop
    break;
}

let mut count = 0;
while count < 5 {
    println!("{}", count);
    count += 1;
}

for i in 0..5 {  // Range (0 to 4)
    println!("{}", i);
}

// For loop with collection
let numbers = vec![1, 2, 3, 4, 5];
for n in numbers {
    println!("{}", n);
}
```

### 5.3 Match Expressions

```rust
// Pattern matching (supercharged switch)
let number = 1;
match number {
    1 => println!("One!"),
    2 | 3 => println!("Two or Three!"),
    4..=10 => println!("4 to 10"),
    _ => println!("Something else"),
}

// Match is exhaustive - must handle all cases
// Destructuring in match
let point = (3, 5);
match point {
    (0, y) => println!("On Y axis at {}", y),
    (x, 0) => println!("On X axis at {}", x),
    (x, y) => println!("At ({}, {})", x, y),
}
```

### 5.4 Option Type

```rust
// Instead of null/undefined, use Option<T>
let some_value: Option<i32> = Some(5);
let no_value: Option<i32> = None;

// Pattern matching
match some_value {
    Some(v) => println!("Value: {}", v),
    None => println!("No value"),
}

// Methods
some_value.map(|x| x + 1);        // Some(6)
some_value.unwrap_or(0);          // 5
some_value.expect("msg");         // 5 or panic
```

### 5.5 Exercise 2

```rust
// Convert this JS function to Rust:
// function getUserName(user) {
//   return user?.name || "Anonymous";
// }

fn get_user_name(user: Option<&User>) -> String {
    // Your implementation
}
```

<details>
<summary>Solution</summary>

```rust
fn get_user_name(user: Option<&User>) -> String {
    user?.name.clone().unwrap_or_else(|| "Anonymous".to_string())
    // Or with match:
    // match user {
    //     Some(u) => u.name.clone(),
    //     None => "Anonymous".to_string(),
    // }
}
```
</details>

---

## 6. Ownership, Borrowing, and Lifetimes

### 6.1 The Three Rules of Ownership

1. Each value has **one owner** at a time
2. When owner goes out of scope, value is **dropped**
3. You can have **one mutable OR many immutable references**

### 6.2 References and Borrowing

```rust
fn main() {
    let s1 = String::from("hello");
    
    // Borrow s1 (immutable reference)
    let len = calculate_length(&s1);
    
    // s1 is still valid!
    println!("s1 = {}", s1);
}

fn calculate_length(s: &String) -> usize {
    s.len()  // &String doesn't take ownership
}
```

### 6.3 Mutable References

```rust
fn main() {
    let mut s = String::from("hello");
    
    // Mutable borrow
    change(&mut s);
    
    println!("{}", s);  // "hello world"
}

fn change(s: &mut String) {
    s.push_str(" world");
}
```

### 6.4 Reference Rules in Action

```rust
// This works - immutable borrows can coexist
let mut s = String::from("hello");
let r1 = &s;
let r2 = &s;
println!("{} and {}", r1, r2);

// This does NOT work - mutable + immutable
let mut s = String::from("hello");
let r1 = &s;              // immutable borrow
// let r2 = &mut s;       // ERROR: cannot borrow as mutable
println!("{}", r1);       // immutable borrow ends here
let r2 = &mut s;          // OK now
```

### 6.5 Lifetimes

```rust
// Lifetimes ensure references don't outlive their data
fn longest<'a>(x: &'a str, y: &'a str) -> &'a str {
    if x.len() > y.len() { x } else { y }
}

// The 'a lifetime parameter says:
// "The returned reference lives as long as the shorter of x and y"
```

### 6.6 Deref Coercion

```rust
// &String automatically coerces to &str
fn takes_str(s: &str) {
    println!("{}", s);
}

let s = String::from("hello");
takes_str(&s);  // &String coerced to &str
```

### 6.7 Exercise 3

```rust
// Fix the borrowing issues:
fn process_data(data: &mut Vec<i32>) -> i32 {
    let first = data[0];
    data.push(first * 2);
    first
}

fn main() {
    let mut numbers = vec![1, 2, 3];
    let result = process_data(&mut numbers);
    println!("Result: {}, Data: {:?}", result, numbers);
}
```

---

## 7. Structs and Enums

### 7.1 Structs

```rust
// Basic struct (like a TypeScript interface/class)
struct User {
    username: String,
    email: String,
    active: bool,
}

// Instance creation
let user = User {
    username: String::from("john"),
    email: String::from("john@example.com"),
    active: true,
};

// Access fields
println!("{}", user.username);
user.active = false;  // If mutable

// Struct update syntax
let user2 = User {
    email: String::from("new@example.com"),
    ..user  // Copy remaining fields
};
```

### 7.2 Tuple Structs

```rust
struct Color(i32, i32, i32);
struct Point(f64, f64, f64);

let c = Color(255, 0, 0);
let r = c.0;  // Access by position
```

### 7.3 Unit Structs

```rust
struct AlwaysEqual;  // Like a singleton marker

let x = AlwaysEqual;
```

### 7.4 Enums

```rust
// Enums can hold data (unlike JS enums)
enum Message {
    Quit,
    Move { x: i32, y: i32 },
    Write(String),
    ChangeColor(i32, i32, i32),
}

let m1 = Message::Quit;
let m2 = Message::Move { x: 10, y: 20 };
let m3 = Message::Write(String::from("hello"));

// Pattern matching
match m2 {
    Message::Quit => println!("Quit"),
    Message::Move { x, y } => println!("Move to {}, {}", x, y),
    Message::Write(text) => println!("Write: {}", text),
    Message::ChangeColor(r, g, b) => println!("Color: {},{},{}", r, g, b),
}
```

### 7.5 Option as an Enum

```rust
// Option is defined like this:
enum Option<T> {
    Some(T),
    None,
}

// Result for error handling
enum Result<T, E> {
    Ok(T),
    Err(E),
}
```

### 7.6 Methods and Implementations

```rust
struct Rectangle {
    width: u32,
    height: u32,
}

impl Rectangle {
    // Constructor method
    fn new(width: u32, height: u32) -> Self {
        Self { width, height }
    }
    
    // Instance method (self takes ownership)
    fn area(&self) -> u32 {
        self.width * self.height
    }
    
    // Method with mutable self
    fn grow(&mut self, factor: u32) {
        self.width *= factor;
        self.height *= factor;
    }
    
    // Static method
    fn is_square(width: u32, height: u32) -> bool {
        width == height
    }
}

// Usage
let rect = Rectangle::new(10, 20);
println!("Area: {}", rect.area());
```

### 7.7 Exercise 4

```rust
// Create a BankAccount struct with:
// - owner: String
// - balance: f64
// Methods:
// - deposit(amount: f64)
// - withdraw(amount: f64) -> Result<f64, String>
// - get_balance() -> f64

struct BankAccount {
    // ...
}

impl BankAccount {
    // ...
}
```

<details>
<summary>Solution</summary>

```rust
struct BankAccount {
    owner: String,
    balance: f64,
}

impl BankAccount {
    fn new(owner: String, balance: f64) -> Self {
        Self { owner, balance }
    }
    
    fn deposit(&mut self, amount: f64) {
        self.balance += amount;
    }
    
    fn withdraw(&mut self, amount: f64) -> Result<f64, String> {
        if self.balance >= amount {
            self.balance -= amount;
            Ok(amount)
        } else {
            Err(format!("Insufficient funds. Balance: {}", self.balance))
        }
    }
    
    fn get_balance(&self) -> f64 {
        self.balance
    }
}
```
</details>

---

## 8. Error Handling

### 8.1 Panic vs Result

```rust
// Panic - like throwing an error (use for unrecoverable)
fn panic_example(x: i32) {
    if x < 0 {
        panic!("x must be non-negative: {}", x);
    }
}

// Result - for recoverable errors
fn divide(a: f64, b: f64) -> Result<f64, String> {
    if b == 0.0 {
        Err("Cannot divide by zero".to_string())
    } else {
        Ok(a / b)
    }
}
```

### 8.2 Handling Result

```rust
let result: Result<i32, String> = Ok(5);

// Pattern matching
match result {
    Ok(value) => println!("Got: {}", value),
    Err(e) => println!("Error: {}", e),
}

// unwrap - panics on error
let value = result.unwrap();

// expect - panic with custom message
let value = result.expect("This should not fail");

// unwrap_or - provide default
let value = result.unwrap_or(0);

// unwrap_or_else - compute default
let value = result.unwrap_or_else(|| -1);
```

### 8.3 The ? Operator

```rust
// Propagate errors automatically (like try/catch)
fn read_file(path: &str) -> Result<String, std::io::Error> {
    let content = std::fs::read_to_string(path)?;  // Propagates error
    Ok(content)
}

// Equivalent to:
fn read_file_explicit(path: &str) -> Result<String, std::io::Error> {
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(e) => return Err(e),
    };
    Ok(content)
}
```

### 8.4 Custom Error Types

```rust
use std::fmt;

#[derive(Debug)]
enum MyError {
    InvalidInput(String),
    NotFound(String),
    Io(std::io::Error),
}

impl fmt::Display for MyError {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        match self {
            MyError::InvalidInput(msg) => write!(f, "Invalid input: {}", msg),
            MyError::NotFound(item) => write!(f, "Not found: {}", item),
            MyError::Io(e) => write!(f, "IO error: {}", e),
        }
    }
}

impl std::error::Error for MyError {}
```

### 8.5 Exercise 5

```rust
// Create a function that parses a string to i32
// Returns Result<i32, ParseError>
// ParseError should be a custom enum

enum ParseError {
    EmptyInput,
    InvalidNumber(String),
    OutOfRange(String),
}

fn parse_int(s: &str) -> Result<i32, ParseError> {
    // Your implementation
}
```

<details>
<summary>Solution</summary>

```rust
enum ParseError {
    EmptyInput,
    InvalidNumber(String),
    OutOfRange(String),
}

fn parse_int(s: &str) -> Result<i32, ParseError> {
    if s.is_empty() {
        return Err(ParseError::EmptyInput);
    }
    
    match s.parse::<i32>() {
        Ok(n) => Ok(n),
        Err(_) => Err(ParseError::InvalidNumber(s.to_string())),
    }
}
```
</details>

---

## 9. Modules and Crates

### 9.1 Module System

```rust
// src/lib.rs or src/main.rs

mod calculator {
    pub fn add(a: i32, b: i32) -> i32 {
        a + b
    }
    
    fn private_func() {
        // Not accessible outside module
    }
}

fn main() {
    let sum = calculator::add(2, 3);
}
```

### 9.2 File Organization

```
src/
├── main.rs
├── lib.rs
├── math/
│   ├── mod.rs
│   ├── addition.rs
│   └── subtraction.rs
└── utils/
    └── mod.rs
```

```rust
// src/math/mod.rs
pub mod addition;
pub mod subtraction;

// src/math/addition.rs
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}
```

### 9.3 Using External Crates

```toml
# Cargo.toml
[dependencies]
serde = { version = "1.0", features = ["derive"] }
reqwest = "0.11"
tokio = { version = "1", features = ["full"] }
```

```rust
// src/main.rs
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct User {
    id: u32,
    name: String,
}
```

### 9.4 Re-exports

```rust
// Clean public API
pub mod math {
    pub use crate::math::addition::add;
    pub use crate::math::subtraction::subtract;
}

// Now users can do:
// use my_crate::math::add;
```

---

## 10. Traits and Generics

### 10.1 Traits (Like TypeScript Interfaces)

```rust
// Define a trait
trait Displayable {
    fn display(&self) -> String;
    
    // Default implementation
    fn display_uppercase(&self) -> String {
        self.display().to_uppercase()
    }
}

struct Person {
    name: String,
}

impl Displayable for Person {
    fn display(&self) -> String {
        format!("Person: {}", self.name)
    }
}

// Usage
let person = Person { name: "Alice".to_string() };
println!("{}", person.display());
```

### 10.2 Trait Bounds

```rust
// Generic function with trait bound
fn print_displayable<T: Displayable>(item: &T) {
    println!("{}", item.display());
}

// Where clause (for complex bounds)
fn process<T, U>(t: T, u: U) -> i32
where
    T: Clone,
    U: Displayable,
{
    // ...
    42
}
```

### 10.3 Common Traits

```rust
// Clone - create a deep copy
let s2 = s1.clone();

// Copy - copy on assignment (for small types)
let x = 5;
let y = x;  // Copied, not moved

// Debug - debug formatting
println!("{:?}", value);

// PartialEq - equality comparison
if a == b { }

// Eq - stronger equality

// PartialOrd / Ord - ordering
if a > b { }

// Display - user-facing formatting
println!("{}", value);

// Default - default value
let x: i32 = Default::default();  // 0
```

### 10.4 Generics

```rust
// Generic struct
struct Pair<T> {
    first: T,
    second: T,
}

impl<T> Pair<T> {
    fn new(first: T, second: T) -> Self {
        Self { first, second }
    }
    
    fn first(&self) -> &T {
        &self.first
    }
}

// Generic with multiple types
struct Mixed<T, U> {
    t: T,
    u: U,
}

// Generic function
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

### 10.5 Exercise 6

```rust
// Implement a generic Stack<T> with:
// - push(item: T)
// - pop() -> Option<T>
// - is_empty() -> bool
// - len() -> usize

struct Stack<T> {
    items: Vec<T>,
}

impl<T> Stack<T> {
    // ...
}
```

<details>
<summary>Solution</summary>

```rust
struct Stack<T> {
    items: Vec<T>,
}

impl<T> Stack<T> {
    fn new() -> Self {
        Self { items: Vec::new() }
    }
    
    fn push(&mut self, item: T) {
        self.items.push(item);
    }
    
    fn pop(&mut self) -> Option<T> {
        self.items.pop()
    }
    
    fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
    
    fn len(&self) -> usize {
        self.items.len()
    }
}
```
</details>

---

## 11. Smart Pointers and Memory Management

### 11.1 Box<T> - Heap Allocation

```rust
// Stack allocation (default)
let x = 5;

// Heap allocation
let b = Box::new(5);
println!("{}", *b);  // Deref coercion

// Recursive types
enum List {
    Cons(i32, Box<List>),
    Nil,
}

fn main() {
    let list = Cons(1, Box::new(Cons(2, Box::new(Nil))));
}
```

### 11.2 Rc<T> - Reference Counting

```rust
use std::rc::Rc;

let a = Rc::new(String::from("hello"));
let b = Rc::clone(&a);  // Increment ref count
let c = Rc::clone(&a);

println!("Ref count: {}", Rc::strong_count(&a));  // 3

// When all references drop, memory is freed
```

### 11.3 RefCell<T> - Interior Mutability

```rust
use std::cell::RefCell;

let x = RefCell::new(5);

// Borrow at runtime, not compile time
let mut y = x.borrow_mut();
*y = 10;

// Multiple immutable borrows
let a = x.borrow();
let b = x.borrow();
```

### 11.4 Rc<RefCell<T>> - Shared Mutable State

```rust
use std::rc::Rc;
use std::cell::RefCell;

struct Node {
    value: i32,
    children: Vec<Rc<RefCell<Node>>>,
}

fn main() {
    let leaf = Rc::new(RefCell::new(Node {
        value: 3,
        children: vec![],
    }));
    
    let node = Rc::new(RefCell::new(Node {
        value: 5,
        children: vec![Rc::clone(&leaf)],
    }));
}
```

### 11.5 Comparison Table

| Type | Ownership | Mutability | Use Case |
|------|-----------|------------|----------|
| `Box<T>` | Single | Compile-time | Heap allocation, recursive types |
| `Rc<T>` | Shared | Immutable | Multiple owners, no mutation |
| `RefCell<T>` | Single | Runtime | Mutation behind immutable reference |
| `Rc<RefCell<T>>` | Shared | Runtime | Complex data structures |

---

## 12. Concurrency

### 12.1 Threads

```rust
use std::thread;
use std::time::Duration;

fn main() {
    let handle = thread::spawn(|| {
        for i in 0..5 {
            println!("Hello from thread: {}", i);
            thread::sleep(Duration::from_millis(100));
        }
    });
    
    handle.join().unwrap();  // Wait for thread
}
```

### 12.2 Message Passing

```rust
use std::thread;
use std::sync::mpsc;  // Multiple Producer, Single Consumer

fn main() {
    let (tx, rx) = mpsc::channel();
    
    thread::spawn(move || {
        let msg = String::from("hello");
        tx.send(msg).unwrap();  // tx moved into thread
    });
    
    let received = rx.recv().unwrap();
    println!("Received: {}", received);
}
```

### 12.3 Shared State with Mutex

```rust
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let counter = Arc::new(Mutex::new(0));
    let mut handles = vec![];
    
    for _ in 0..10 {
        let counter = Arc::clone(&counter);
        let handle = thread::spawn(move || {
            let mut num = counter.lock().unwrap();
            *num += 1;
        });
        handles.push(handle);
    }
    
    for handle in handles {
        handle.join().unwrap();
    }
    
    println!("Result: {}", *counter.lock().unwrap());
}
```

### 12.4 Arc vs Rc

| Feature | Rc | Arc |
|---------|----|-----|
| Thread Safety | No | Yes |
| Use Case | Single-threaded | Multi-threaded |
| Performance | Faster | Slightly slower |

### 12.5 Exercise 7

```rust
// Create a thread pool that processes numbers 1-100
// Each thread should square its numbers
// Collect results in a shared vector

use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let results = Arc::new(Mutex::new(vec![]));
    let mut handles = vec![];
    
    // Your implementation
}
```

---

## 13. Async/await in Rust

### 13.1 Basic Async

```rust
use tokio;

async fn fetch_data() -> String {
    // Simulate async operation
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
    String::from("data")
}

#[tokio::main]
async fn main() {
    let result = fetch_data().await;
    println!("{}", result);
}
```

### 13.2 Comparison with JavaScript

```javascript
// JavaScript
async function fetchData() {
    const response = await fetch('/api/data');
    return response.json();
}
```

```rust
// Rust
async fn fetch_data() -> Result<JsonData, reqwest::Error> {
    let response = reqwest::get("/api/data").await?;
    Ok(response.json().await?)
}
```

### 13.3 Concurrent Async Tasks

```rust
use tokio::join;

#[tokio::main]
async fn main() {
    let (result1, result2) = join!(
        fetch_data("url1"),
        fetch_data("url2")
    );
}
```

### 13.4 Async Channels

```rust
use tokio::sync::mpsc;

async fn producer(tx: mpsc::Sender<String>) {
    for i in 0..5 {
        tx.send(format!("Message {}", i)).await.unwrap();
    }
}

async fn consumer(rx: mpsc::Receiver<String>) {
    while let Some(msg) = rx.recv().await {
        println!("Received: {}", msg);
    }
}
```

### 13.5 Common Async Patterns

```rust
// Timeout
use tokio::time::{timeout, Duration};

let result = timeout(Duration::from_secs(5), async {
    fetch_data().await
}).await;

// Race
use tokio::select;

select! {
    _ = fetch_data() => println!("Data fetched"),
    _ = tokio::time::sleep(Duration::from_secs(10)) => println!("Timeout"),
}

// Retry with exponential backoff
async fn fetch_with_retry(url: &str, max_retries: u32) -> Result<String, Error> {
    let mut attempt = 0;
    while attempt < max_retries {
        match fetch(url).await {
            Ok(data) => return Ok(data),
            Err(e) => {
                attempt += 1;
                tokio::time::sleep(Duration::from_secs(2u64.pow(attempt))).await;
            }
        }
    }
    Err(Error::MaxRetriesExceeded)
}
```

---

## 14. Working with External APIs

### 14.1 HTTP Client with reqwest

```rust
use reqwest;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct User {
    id: u32,
    name: String,
    email: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // GET request
    let response = reqwest::get("https://api.example.com/users/1")
        .await?
        .json::<User>()
        .await?;
    
    println!("User: {}", response.name);
    
    // POST request
    let new_user = serde_json::json!({
        "name": "John Doe",
        "email": "john@example.com"
    });
    
    let response = reqwest::Client::new()
        .post("https://api.example.com/users")
        .json(&new_user)
        .send()
        .await?;
    
    Ok(())
}
```

### 14.2 JSON Serialization with serde

```rust
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
struct Config {
    database_url: String,
    port: u16,
    debug: bool,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Serialize
    let config = Config {
        database_url: "postgres://localhost".to_string(),
        port: 5432,
        debug: true,
    };
    
    let json = serde_json::to_string_pretty(&config)?;
    println!("{}", json);
    
    // Deserialize
    let json = r#"{"database_url":"postgres://localhost","port":5432,"debug":true}"#;
    let config: Config = serde_json::from_str(json)?;
    
    Ok(())
}
```

### 14.3 Environment Variables

```rust
use std::env;

fn main() {
    let port = env::var("PORT")
        .unwrap_or_else(|_| "3000".to_string())
        .parse::<u16>()
        .expect("Invalid PORT");
    
    println!("Server running on port {}", port);
}
```

### 14.4 Configuration Files

```rust
use serde::Deserialize;
use std::fs;

#[derive(Deserialize)]
struct AppConfig {
    server: ServerConfig,
    database: DatabaseConfig,
}

#[derive(Deserialize)]
struct ServerConfig {
    host: String,
    port: u16,
}

#[derive(Deserialize)]
struct DatabaseConfig {
    url: String,
    pool_size: u32,
}

fn load_config(path: &str) -> Result<AppConfig, Box<dyn std::error::Error>> {
    let content = fs::read_to_string(path)?;
    let config: AppConfig = serde_json::from_str(&content)?;
    Ok(config)
}
```

---

## 15. Testing

### 15.1 Unit Tests

```rust
// In the same file as the code
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_add_positive() {
        assert_eq!(add(2, 3), 5);
    }
    
    #[test]
    fn test_add_negative() {
        assert_eq!(add(-2, -3), -5);
    }
    
    #[test]
    #[should_panic]
    fn test_panic() {
        panic!("This test expects a panic");
    }
}

// Run tests
cargo test
```

### 15.2 Integration Tests

```
tests/
└── integration_test.rs
```

```rust
// tests/integration_test.rs
use my_crate::add;

#[test]
fn test_add_integration() {
    assert_eq!(add(2, 3), 5);
}
```

### 15.3 Testing Private Functions

```rust
mod tests {
    use super::*;
    
    #[test]
    fn test_private_function() {
        // Can access private items in same module
        let result = private_helper(5);
        assert_eq!(result, 10);
    }
}
```

### 15.4 Testing Async Code

```rust
#[tokio::test]
async fn test_async_function() {
    let result = fetch_data().await;
    assert!(result.is_ok());
}
```

### 15.5 Mocking

```rust
// Using mockall or similar
#[cfg(test)]
mod tests {
    use mockall::mock;
    
    mock! {
        pub Database {
            fn query(&self, sql: &str) -> Result<Vec<Row>, Error>;
        }
    }
    
    #[test]
    fn test_with_mock() {
        let mut mock_db = MockDatabase::new();
        mock_db.expect_query()
            .returning(|_| Ok(vec![]));
        
        // Test code using mock_db
    }
}
```

---

## 16. Build Tools and Ecosystem

### 16.1 Cargo Features

```toml
# Cargo.toml
[features]
default = ["std"]
std = []
async = ["tokio"]
full = ["std", "async"]
```

```rust
// Conditional compilation
#[cfg(feature = "async")]
async fn process_async() {
    // Async implementation
}

#[cfg(not(feature = "async"))]
fn process_sync() {
    // Sync implementation
}
```

### 16.2 Common Crates

| Crate | Purpose |
|-------|---------|
| `tokio` | Async runtime |
| `reqwest` | HTTP client |
| `serde` | Serialization |
| `clap` | CLI argument parsing |
| `anyhow` | Error handling |
| `thiserror` | Custom error types |
| `tracing` | Logging/observability |
| `sqlx` | SQL database |
| `axum` | Web framework |
| `actix-web` | Web framework |

### 16.3 CLI with clap

```rust
use clap::Parser;

#[derive(Parser, Debug)]
#[command(author, version, about)]
struct Args {
    #[arg(short, long)]
    input: Option<String>,
    
    #[arg(short, long, default_value_t = 80)]
    width: usize,
}

fn main() {
    let args = Args::parse();
    println!("Input: {:?}, Width: {}", args.input, args.width);
}
```

### 16.4 Build Profiles

```toml
# Cargo.toml
[profile.release]
opt-level = 3
lto = true

[profile.dev]
opt-level = 0
debug = true
```

---

## 17. Best Practices and Common Pitfalls

### 17.1 Ownership Patterns

```rust
// ❌ Don't clone unnecessarily
let s1 = String::from("hello");
let s2 = s1.clone();  // Only if you need both

// ✅ Use references when possible
fn process(s: &str) {
    // ...
}

// ✅ Move when ownership transfer is intended
fn take_ownership(s: String) {
    // ...
}
```

### 17.2 Error Handling Patterns

```rust
// ❌ Don't use unwrap() in production
let value = result.unwrap();

// ✅ Use ? for error propagation
fn process() -> Result<(), Error> {
    let value = get_value()?;
    Ok(())
}

// ✅ Use expect() with context
let value = result.expect("Failed to load config");

// ✅ Handle errors explicitly when needed
match result {
    Ok(v) => process(v),
    Err(e) => log_error(e),
}
```

### 17.3 Common Pitfalls

```rust
// 1. Mutable + Immutable references
let mut data = vec![1, 2, 3];
let immutable = &data;  // OK
// let mutable = &mut data;  // ERROR!

// 2. Dangling references
fn bad() -> &str {
    let s = String::from("hello");
    &s  // ERROR: s is dropped!
}

// 3. Forgetting to clone
fn process(s: String) -> String {
    // s is moved here
    // s  // ERROR: already moved
}

// 4. Lifetime confusion
fn longest<'a>(x: &'a str, y: &str) -> &'a str {
    // ERROR: y doesn't have 'a lifetime
    x
}
```

### 17.4 Performance Tips

```rust
// 1. Use capacity hints
let mut vec = Vec::with_capacity(1000);

// 2. Reserve space in strings
let mut s = String::with_capacity(256);

// 3. Use iterators (lazy evaluation)
let sum: i32 = (0..100).map(|x| x * 2).sum();

// 4. Avoid unnecessary allocations
fn process(s: &str) {  // &str instead of String
    // ...
}

// 5. Use debug_assert for expensive checks
debug_assert!(x > 0);  // Only in debug builds
```

### 17.5 Code Style

```rust
// Follow rustfmt defaults
cargo fmt

// Use clippy for linting
cargo clippy

// Common conventions:
// - snake_case for functions/variables
// - PascalCase for types
// - SCREAMING_SNAKE for constants
// - 4-space indentation
// - 100 char line width
```

---

## 18. Next Steps and Resources

### 18.1 Learning Path

1. **The Book** (rust-lang.org) - Official tutorial
2. **Rust By Example** - Code examples
3. **Rustlings** - Interactive exercises
4. **Exercism** - Practice problems with mentorship

### 18.2 Practice Projects

| Level | Project |
|-------|---------|
| Beginner | CLI todo app |
| Intermediate | HTTP server, REST API |
| Advanced | Database client, async web app |

### 18.3 Community Resources

- **Rust Users Forum** - Questions and discussions
- **Rust Discord** - Real-time help
- **r/rust** - Reddit community
- **Rust Show** - Podcast

### 18.4 Cheatsheet

```rust
// Quick reference

// Types
let x: i32 = 5;           // Integer
let f: f64 = 3.14;        // Float
let b: bool = true;       // Boolean
let c: char = 'A';        // Character
let s: &str = "text";     // String slice
let s: String = String::from("text");  // Owned string

// Collections
let v = vec![1, 2, 3];    // Vector
let m = HashMap::new();   // HashMap
let a = [1, 2, 3];        // Array

// Control Flow
if condition { } else { }
while condition { }
for item in collection { }
loop { break; }

// Match
match value {
    pattern => expression,
    _ => default,
}

// Option
let opt: Option<T> = Some(value);
opt.map(|x| x * 2);
opt.unwrap_or(default);
opt.expect("message");

// Result
let res: Result<T, E> = Ok(value);
res?;  // Propagate error
res.unwrap();

// Traits
trait TraitName {
    fn method(&self);
}

impl TraitName for Type {
    fn method(&self) { }
}

// Generics
fn generic<T>(item: T) -> T { item }

// Async
async fn function() -> Result<T, E> { }
let result = function().await;

// Testing
#[test]
fn test_name() {
    assert_eq!(1 + 1, 2);
}
```

---

## Conclusion

You've now covered the fundamentals of Rust! Remember:

1. **Ownership is key** - Understand move semantics
2. **Borrowing is safe** - References prevent data races
3. **Errors are values** - Use Result and Option
4. **The compiler is your friend** - Fix errors, don't fight them
5. **Practice consistently** - Build small projects regularly

**Happy Rusting! 🦀**

---

*Generated for intermediate JS/TS developers transitioning to Rust*
