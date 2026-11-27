# Rank Go method declarations as definitions

Slug: rank-recognizes-go-method-definitions
Model: not applicable — the change is a stateless classification of one line of text
Acceptance:
- .kogen/intents/rank-recognizes-go-method-definitions/acceptance.feature
- features/steps/rank-recognizes-go-method-definitions__steps.js

In `src/rank.rs`, `is_definition` recognizes a definition only when a definition keyword stands directly before the matched name, so a Go method declaration such as `func (s *Server) Handle(w int) {` is ranked as a call (or reference) when searching for `Handle`. After this change, in a Go file (extension `go`), a receiver group directly after the `func` keyword and before the matched name counts as part of the keyword: the line is a definition, for a value receiver (`func (s Server) Handle`) and a pointer receiver (`func (s *Server) Handle`) alike. Lines that are not receiver method declarations keep their current kind: a receiver method call such as `s.Handle(req)` stays a call, and a similarly named reference such as `h := s.Handle` or the different method `func (s *Server) HandleAll(` stays a reference.

Out of scope and unchanged: ranking tiers and their order, every other language (the receiver rule applies to `go` files only), and path-order search.

## Decisions
- A Go receiver method declaration is a definition line when searching for its method name: the text before the name is `func`, at least one blank, a receiver group `(...)` and at least one blank, with the same word-boundary rule after the name as for every other definition. Value receivers, pointer receivers, unnamed receivers and generic receivers (`(s *Server[T])`) all qualify. (constraint: ranking tiers unchanged; a definition is still tier 0 in source files) (evidence: src/rank.rs) (source: request)
- The receiver rule applies only to files with the extension `go` and only after the keyword `func`; `fn`, `struct` and the other keywords followed by a parenthesized group, and the same text in other languages, are not definitions. (constraint: other languages unchanged) (evidence: src/rank.rs) (source: request)
- `func(s *Server) Handle` with no blank between `func` and `(` is a function literal with a result type, not a method declaration, and stays a call or reference. gofmt writes method declarations with a blank after `func`. (constraint: a blank is required between `func` and the receiver group) (assumption: unformatted `func(s S) Name` is not a method declaration for ranking; confirm this is wanted) (evidence: src/rank.rs) (source: request)
- A receiver method call (`s.Handle(req)`, `defer func() { s.Handle(1) }()`) stays a call, and a similarly named reference (`h := s.Handle`, `func (s *Server) HandleAll(`) stays a reference; not every name after a `func` keyword is a definition. (constraint: calls and references keep their current tiers) (evidence: src/rank.rs) (source: request)
- Acceptance runs the built `kogen-context request` with a ranked search over a temporary `a.go` and observes the order of the returned lines, because tiers are observable only through the ranked order (tier, then path, then line). (evidence: src/rank.rs; features/steps/rank-ignores-single-quoted-comment-markers__steps.js) (source: request)
- Go receiver method declarations (func, blank, receiver group, blank, name) are definitions in go files only (decision: D1, round 1) (constraint: tiers unchanged) (constraint: other languages unchanged) (evidence: src/rank.rs) (assumption: Scratch run (not retained by Kogen) showed the correct overlay passes the rank unit tests and ranks a Go fixture as definition, calls, references; each wrong overlay changed that order.) (source: request)
- func( with no blank is a function literal, not a method declaration (decision: D2, round 1) (evidence: src/rank.rs) (assumption: Unformatted Go method declarations without a blank after func are left as calls/references.) (source: request)

## Source comparison
- Addressed: a Go value receiver method declaration ranks as a definition (scenario 1; request check 1).
- Addressed: a Go pointer receiver method declaration ranks as a definition (scenario 2; request check 2).
- Addressed: a receiver method call and similarly named references remain calls and references (scenario 3; request check 3).
- Out of scope and unchanged: ranking tiers, other languages, path-order search.

## Tests
- A value or pointer receiver method declaration is a definition in a Go file; calls, similarly named references, `func(` without a blank, other keywords and other extensions are not: extend the `definitions_and_their_keyword_boundaries` unit test in `src/rank.rs` (unit)
- The ranked order of a real search over a Go file puts value and pointer receiver declarations before calls and references: the acceptance scenarios run `kogen-context request` (scenario)

## Feasibility
- none
