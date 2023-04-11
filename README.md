# Go Test Suite Support

Run Go test functions written in third-party library formats (e.g., [`gocheck`][gocheck]) from the *Testing* sidebar.


## Supported test libraries

- go-check ([`gopkg.in/check.v1`][gocheck-pkg])

[gocheck]: https://labix.org/gocheck
[gocheck-pkg]: https://pkg.go.dev/gopkg.in/check.v1

## Notes

- **`go-check`** might need you to include this bootstrap function in your test packages:
  ```go
  // Hook up go-check into the "go test" runner.
  func Test(t *testing.T) { 
      check.TestingT(t) 
  }
  ```

## Feedback

Please kindly provide your feedbacks and/or suggestions by submitting a new issue in the extension's GitHub [repository][repo]. 🍏

[repo]: https://github.com/babakks/vscode-go-test-suite/issues
