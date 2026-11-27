Feature: Ranking recognizes Go receiver method declarations as definitions

  This feature covers the ranked order of a search of a Go file.
  A method declaration with a value or pointer receiver ranks as a definition;
  calls and similarly named references keep their kinds.

  Scenario: A value receiver method declaration ranks as a definition
    Given rank-recognizes-go-method-definitions: a file "a.go" containing the lines:
      """
      s.Handle(req)
      func (s Server) Handle(req int) {
      """
    When rank-recognizes-go-method-definitions: I run a ranked search for "Handle"
    Then rank-recognizes-go-method-definitions: the matches are on lines "2, 1" in that order

  Scenario: A pointer receiver method declaration ranks as a definition
    Given rank-recognizes-go-method-definitions: a file "a.go" containing the lines:
      """
      s.Handle(req)
      func (s *Server) Handle(req int) {
      """
    When rank-recognizes-go-method-definitions: I run a ranked search for "Handle"
    Then rank-recognizes-go-method-definitions: the matches are on lines "2, 1" in that order

  Scenario: Calls and similarly named references stay below the method definition
    Given rank-recognizes-go-method-definitions: a file "a.go" containing the lines:
      """
      defer func() { s.Handle(1) }()
      func (s *Server) Handle(w int) {
      func (s *Server) HandleAll(w int) {
      h := s.Handle
      s.Handle(req)
      """
    When rank-recognizes-go-method-definitions: I run a ranked search for "Handle"
    Then rank-recognizes-go-method-definitions: the matches are on lines "2, 1, 5, 3, 4" in that order
