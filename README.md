# Go Test Suite Support

Run Go test functions written in third-party library formats (e.g., [`gocheck`][gocheck]) from the *Testing* sidebar.


## Features

- Run/debug tests by clicking on the Code Lens button appearing above test functions.

## Supported test libraries

- go-check ([`gopkg.in/check.v1`][gocheck-pkg])
- quicktest ([`github.com/frankban/quicktest`][quicktest-pkg])
- qtsuite ([`github.com/frankban/quicktest/qtsuite`][qtsuite-pkg])

[gocheck]: https://labix.org/gocheck
[gocheck-pkg]: https://pkg.go.dev/gopkg.in/check.v1
[quicktest-pkg]: https://pkg.go.dev/github.com/frankban/quicktest
[qtsuite-pkg]: https://pkg.go.dev/github.com/frankban/quicktest/qtsuite

## Notes

- **`go-check`** might need you to include this bootstrap function in your test packages:
  ```go
  // Hook up go-check into the "go test" runner.
  func Test(t *testing.T) { 
      check.TestingT(t) 
  }

  type myTestSuite struct {
  }

  var _ = check.Suite(&myTestSuite{})

  func (s *myTestSuite) TestSomething(c *check.C) {
    // ...
  }
  ```

- **`quicktest` and `qtsuite`** might need you to include this bootstrap function in your test packages (given that your test suite struct is named `myTestSuite`):
  ```go
  // Register your test suite's functions as subtests.
  func Test(t *testing.T) { 
    qtsuite.Run(quicktest.New(t), &myTestSuite{})
  }

  type myTestSuite struct {
  }

  func (s *myTestSuite) TestSomething(c *quicktest.C) {
    // ...
  }
  ```

## Feedback

Please kindly provide your feedbacks and/or suggestions by submitting a new issue in the extension's GitHub [repository][repo]. 🍏

[repo]: https://github.com/babakks/vscode-go-test-suite/issues
