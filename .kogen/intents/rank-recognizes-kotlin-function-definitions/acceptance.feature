Feature: Kotlin function definitions in ranked search
  This feature ranks a Kotlin declaration ahead of calls without promoting call sites.

  Scenario: A Kotlin source declaration ranks before calls and references
    Given rank-recognizes-kotlin-function-definitions: a Kotlin file "Spin.kt" containing:
      """
      val alias = ::spin
      val result = spin()
      val display = "fun" + spin()
      fun spin()
      """
    When rank-recognizes-kotlin-function-definitions: I run a ranked search for "spin"
    Then rank-recognizes-kotlin-function-definitions: the matching lines of "Spin.kt" are "4, 2, 3, 1" in that order

  Scenario: A Kotlin script declaration ranks before calls and references
    Given rank-recognizes-kotlin-function-definitions: a Kotlin file "Spin.kts" containing:
      """
      val alias = ::spin
      val result = spin()
      val display = "fun" + spin()
      fun spin()
      """
    When rank-recognizes-kotlin-function-definitions: I run a ranked search for "spin"
    Then rank-recognizes-kotlin-function-definitions: the matching lines of "Spin.kts" are "4, 2, 3, 1" in that order
