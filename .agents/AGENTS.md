# Project Rules

* **Strict TDD Requirement**: This project must be unit, component, and e2e tested using strict TDD (red-green-refactor in the Fowler sense of refactor). Any code change made that does not create tests *first* will be immediately rejected.
* **Black-Box Testing**: A proper test tests expectations, not internal understanding of how the system under test actually works. Any test that makes assumptions about internals will be rejected.
* **Strict Docker Compose Dependency**: MUST NOT install Postgres or other servers directly on the host machine or outside of a tightly controlled Docker Compose setup.
* **Compilation & Linting**: Compiler/tsc and linting errors must be fixed immediately.
* **Test Coverage**: Test coverage must be 80%+ and provable via test tool output.
