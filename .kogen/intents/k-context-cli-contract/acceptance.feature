Feature: Versioned request and packet contract for kogen-context

  `kogen-context request` reads one version 1 JSON request on standard input
  and writes one version 1 JSON packet on standard output. contract/ publishes
  the JSON Schemas of both, example requests with their real packets, and a
  fixture checkout the examples run against.

  Scenario: The contract publishes the version 1 request and packet schemas
    Then k-context-cli-contract: the file "contract/request.schema.json" holds JSON:
      """
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://kogen.dev/schemas/kogen-context/1/request.schema.json",
        "title": "kogen-context request, version 1",
        "description": "The JSON request that `kogen-context request` reads from standard input.",
        "oneOf": [{"$ref": "#/$defs/search"}, {"$ref": "#/$defs/read"}],
        "$defs": {
          "search": {
            "description": "Find an exact, case-sensitive literal in the searchable files under the checkout root.",
            "type": "object",
            "properties": {
              "version": {"const": 1},
              "root": {"$ref": "#/$defs/root"},
              "operation": {"const": "search"},
              "literal": {"type": "string", "minLength": 1},
              "limits": {
                "type": "object",
                "properties": {
                  "max_matches": {"type": "integer", "minimum": 1, "maximum": 100},
                  "max_line_chars": {"$ref": "#/$defs/max_line_chars"}
                },
                "additionalProperties": false
              }
            },
            "required": ["version", "root", "operation", "literal"],
            "additionalProperties": false
          },
          "read": {
            "description": "Read the inclusive line range from start to end of one file inside the checkout root.",
            "type": "object",
            "properties": {
              "version": {"const": 1},
              "root": {"$ref": "#/$defs/root"},
              "operation": {"const": "read"},
              "path": {"type": "string", "minLength": 1},
              "start": {"$ref": "#/$defs/line_number"},
              "end": {"$ref": "#/$defs/line_number"},
              "limits": {
                "type": "object",
                "properties": {
                  "max_lines": {"type": "integer", "minimum": 1, "maximum": 200},
                  "max_line_chars": {"$ref": "#/$defs/max_line_chars"}
                },
                "additionalProperties": false
              }
            },
            "required": ["version", "root", "operation", "path", "start", "end"],
            "additionalProperties": false
          },
          "root": {
            "description": "The checkout root, absolute or relative to the working directory of the process.",
            "type": "string",
            "minLength": 1
          },
          "line_number": {"description": "A 1-based line number.", "type": "integer", "minimum": 1},
          "max_line_chars": {
            "description": "At most this many characters of each line's text are returned.",
            "type": "integer",
            "minimum": 1,
            "maximum": 500
          }
        }
      }
      """
    And k-context-cli-contract: the file "contract/packet.schema.json" holds JSON:
      """
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://kogen.dev/schemas/kogen-context/1/packet.schema.json",
        "title": "kogen-context packet, version 1",
        "description": "The one JSON packet that `kogen-context request` writes to standard output.",
        "oneOf": [{"$ref": "#/$defs/search"}, {"$ref": "#/$defs/read"}, {"$ref": "#/$defs/error"}],
        "$defs": {
          "search": {
            "type": "object",
            "properties": {
              "version": {"const": 1},
              "operation": {"const": "search"},
              "query": {"type": "string", "minLength": 1},
              "matches": {"type": "array", "maxItems": 100, "items": {"$ref": "#/$defs/match"}},
              "truncated": {
                "description": "True exactly when more matching lines exist than max_matches.",
                "type": "boolean"
              },
              "limits": {
                "type": "object",
                "properties": {
                  "max_matches": {"type": "integer", "minimum": 1, "maximum": 100},
                  "max_line_chars": {"$ref": "#/$defs/max_line_chars"}
                },
                "required": ["max_matches", "max_line_chars"],
                "additionalProperties": false
              }
            },
            "required": ["version", "operation", "query", "matches", "truncated", "limits"],
            "additionalProperties": false
          },
          "match": {
            "type": "object",
            "properties": {
              "path": {"$ref": "#/$defs/path"},
              "line": {"$ref": "#/$defs/line_number"},
              "column": {
                "description": "1-based character position of the first occurrence of the literal in the full line.",
                "type": "integer",
                "minimum": 1
              },
              "text": {"$ref": "#/$defs/text"}
            },
            "required": ["path", "line", "column", "text"],
            "additionalProperties": false
          },
          "read": {
            "type": "object",
            "properties": {
              "version": {"const": 1},
              "operation": {"const": "read"},
              "path": {"$ref": "#/$defs/path"},
              "start": {"$ref": "#/$defs/line_number"},
              "end": {"$ref": "#/$defs/line_number"},
              "total_lines": {"type": "integer", "minimum": 1},
              "lines": {"type": "array", "maxItems": 200, "items": {"$ref": "#/$defs/line"}},
              "limits": {
                "type": "object",
                "properties": {
                  "max_lines": {"type": "integer", "minimum": 1, "maximum": 200},
                  "max_line_chars": {"$ref": "#/$defs/max_line_chars"}
                },
                "required": ["max_lines", "max_line_chars"],
                "additionalProperties": false
              }
            },
            "required": ["version", "operation", "path", "start", "end", "total_lines", "lines", "limits"],
            "additionalProperties": false
          },
          "line": {
            "type": "object",
            "properties": {
              "line": {"$ref": "#/$defs/line_number"},
              "text": {"$ref": "#/$defs/text"}
            },
            "required": ["line", "text"],
            "additionalProperties": false
          },
          "error": {
            "type": "object",
            "properties": {
              "version": {"const": 1},
              "error": {
                "type": "object",
                "properties": {
                  "code": {
                    "enum": [
                      "invalid_request",
                      "unsupported_version",
                      "invalid_range",
                      "root_not_directory",
                      "path_outside_root",
                      "not_found",
                      "not_a_file",
                      "not_text"
                    ]
                  },
                  "message": {"type": "string", "minLength": 1}
                },
                "required": ["code", "message"],
                "additionalProperties": false
              }
            },
            "required": ["version", "error"],
            "additionalProperties": false
          },
          "path": {
            "description": "Path relative to the canonicalized checkout root, separated by `/`, never starting with `./`.",
            "type": "string",
            "minLength": 1
          },
          "line_number": {"description": "A 1-based line number.", "type": "integer", "minimum": 1},
          "text": {
            "description": "The first max_line_chars characters of the line, without its line ending.",
            "type": "string",
            "maxLength": 500
          },
          "max_line_chars": {"type": "integer", "minimum": 1, "maximum": 500}
        }
      }
      """
    And k-context-cli-contract: the file "contract/README.md" mentions "kogen-context request"
    And k-context-cli-contract: the file "contract/README.md" mentions "request.schema.json"
    And k-context-cli-contract: the file "contract/README.md" mentions "packet.schema.json"
    And k-context-cli-contract: the file "contract/README.md" mentions "consumes/kogen-context"

  Scenario: The contract examples and their fixture checkout are published
    Then k-context-cli-contract: the directory "contract/examples" holds exactly these files:
      """
      checkout/README.md
      checkout/app.py
      checkout/util.py
      error.packet.json
      error.request.json
      read.packet.json
      read.request.json
      search-limited.packet.json
      search-limited.request.json
      search.packet.json
      search.request.json
      """
    And k-context-cli-contract: the file "contract/examples/checkout/README.md" has the content:
      """
      # Example checkout

      Call parse_config to load settings.
      """
    And k-context-cli-contract: the file "contract/examples/checkout/app.py" has the content:
      """
      from util import parse_config

      CONFIG = parse_config("app.toml")
      """
    And k-context-cli-contract: the file "contract/examples/checkout/util.py" has the content:
      """
      def parse_config(path):
          return open(path).read()
      """

  Scenario: The search example request produces its example packet
    Then k-context-cli-contract: the file "contract/examples/search.request.json" holds JSON:
      """
      {"version": 1, "root": "contract/examples/checkout", "operation": "search", "literal": "parse_config"}
      """
    And k-context-cli-contract: the file "contract/examples/search.packet.json" holds exactly the JSON line:
      """
      {"version":1,"operation":"search","query":"parse_config","matches":[{"path":"README.md","line":3,"column":6,"text":"Call parse_config to load settings."},{"path":"app.py","line":1,"column":18,"text":"from util import parse_config"},{"path":"app.py","line":3,"column":10,"text":"CONFIG = parse_config(\"app.toml\")"},{"path":"util.py","line":1,"column":5,"text":"def parse_config(path):"}],"truncated":false,"limits":{"max_matches":100,"max_line_chars":500}}
      """
    And k-context-cli-contract: the file "contract/examples/search.request.json" validates against "contract/request.schema.json"
    And k-context-cli-contract: the file "contract/examples/search.packet.json" validates against "contract/packet.schema.json"
    When k-context-cli-contract: I send the file "contract/examples/search.request.json" to kogen-context request from the repository root
    Then k-context-cli-contract: the command exits with status 0, prints nothing on stderr and prints exactly the file "contract/examples/search.packet.json"
    And k-context-cli-contract: the printed packet validates against "contract/packet.schema.json"

  Scenario: The limited search example request produces its example packet
    Then k-context-cli-contract: the file "contract/examples/search-limited.request.json" holds JSON:
      """
      {
        "version": 1,
        "root": "contract/examples/checkout",
        "operation": "search",
        "literal": "parse_config",
        "limits": {"max_matches": 2, "max_line_chars": 12}
      }
      """
    And k-context-cli-contract: the file "contract/examples/search-limited.packet.json" holds exactly the JSON line:
      """
      {"version":1,"operation":"search","query":"parse_config","matches":[{"path":"README.md","line":3,"column":6,"text":"Call parse_c"},{"path":"app.py","line":1,"column":18,"text":"from util im"}],"truncated":true,"limits":{"max_matches":2,"max_line_chars":12}}
      """
    And k-context-cli-contract: the file "contract/examples/search-limited.request.json" validates against "contract/request.schema.json"
    And k-context-cli-contract: the file "contract/examples/search-limited.packet.json" validates against "contract/packet.schema.json"
    When k-context-cli-contract: I send the file "contract/examples/search-limited.request.json" to kogen-context request from the repository root
    Then k-context-cli-contract: the command exits with status 0, prints nothing on stderr and prints exactly the file "contract/examples/search-limited.packet.json"
    And k-context-cli-contract: the printed packet validates against "contract/packet.schema.json"

  Scenario: The read example request produces its example packet
    Then k-context-cli-contract: the file "contract/examples/read.request.json" holds JSON:
      """
      {"version": 1, "root": "contract/examples/checkout", "operation": "read", "path": "util.py", "start": 1, "end": 2}
      """
    And k-context-cli-contract: the file "contract/examples/read.packet.json" holds exactly the JSON line:
      """
      {"version":1,"operation":"read","path":"util.py","start":1,"end":2,"total_lines":2,"lines":[{"line":1,"text":"def parse_config(path):"},{"line":2,"text":"    return open(path).read()"}],"limits":{"max_lines":200,"max_line_chars":500}}
      """
    And k-context-cli-contract: the file "contract/examples/read.request.json" validates against "contract/request.schema.json"
    And k-context-cli-contract: the file "contract/examples/read.packet.json" validates against "contract/packet.schema.json"
    When k-context-cli-contract: I send the file "contract/examples/read.request.json" to kogen-context request from the repository root
    Then k-context-cli-contract: the command exits with status 0, prints nothing on stderr and prints exactly the file "contract/examples/read.packet.json"
    And k-context-cli-contract: the printed packet validates against "contract/packet.schema.json"

  Scenario: The error example request produces its example error packet
    Then k-context-cli-contract: the file "contract/examples/error.request.json" holds JSON:
      """
      {"version": 1, "root": "contract/examples/checkout", "operation": "read", "path": "../README.md", "start": 1, "end": 1}
      """
    And k-context-cli-contract: the file "contract/examples/error.packet.json" holds exactly the JSON line:
      """
      {"version":1,"error":{"code":"path_outside_root","message":"path escapes the checkout root: ../README.md"}}
      """
    And k-context-cli-contract: the file "contract/examples/error.request.json" validates against "contract/request.schema.json"
    And k-context-cli-contract: the file "contract/examples/error.packet.json" validates against "contract/packet.schema.json"
    When k-context-cli-contract: I send the file "contract/examples/error.request.json" to kogen-context request from the repository root
    Then k-context-cli-contract: the command exits with status 1, prints nothing on stderr and prints exactly the file "contract/examples/error.packet.json"
    And k-context-cli-contract: the printed packet validates against "contract/packet.schema.json"

  Scenario: A search request with an absolute root returns a version 1 packet with the default limits
    Given k-context-cli-contract: a checkout file "b.txt" with the content:
      """
      find me
      """
    And k-context-cli-contract: a checkout file "a/c.txt" with the content:
      """
      x find me
      """
    When k-context-cli-contract: I send the request:
      """
      {"version": 1, "root": "{root}", "operation": "search", "literal": "find"}
      """
    Then k-context-cli-contract: the request succeeds with the packet:
      """
      {"version":1,"operation":"search","query":"find","matches":[{"path":"a/c.txt","line":1,"column":3,"text":"x find me"},{"path":"b.txt","line":1,"column":1,"text":"find me"}],"truncated":false,"limits":{"max_matches":100,"max_line_chars":500}}
      """

  Scenario: A search request with no hits returns an empty match list
    Given k-context-cli-contract: a checkout file "b.txt" with the content:
      """
      find me
      """
    When k-context-cli-contract: I send the request:
      """
      {"version": 1, "root": "{root}", "operation": "search", "literal": "Find"}
      """
    Then k-context-cli-contract: the request succeeds with the packet:
      """
      {"version":1,"operation":"search","query":"Find","matches":[],"truncated":false,"limits":{"max_matches":100,"max_line_chars":500}}
      """

  Scenario Outline: max_matches bounds the matches and truncated reports whether more exist
    Given k-context-cli-contract: a checkout file "many.txt" of <lines> lines each containing "needle"
    When k-context-cli-contract: I send the request:
      """
      {"version": 1, "root": "{root}", "operation": "search", "literal": "needle"<limits>}
      """
    Then k-context-cli-contract: the request succeeds with <count> matches in "many.txt" from line 1, truncated "<truncated>", max matches <max> and max line chars 500

    Examples:
      | lines | limits                            | count | truncated | max |
      | 2     | , "limits": {"max_matches": 1}    | 1     | true      | 1   |
      | 3     | , "limits": {"max_matches": 2}    | 2     | true      | 2   |
      | 3     | , "limits": {"max_matches": 3}    | 3     | false     | 3   |
      | 101   | , "limits": {"max_matches": 100}  | 100   | true      | 100 |
      | 101   |                                   | 100   | true      | 100 |
      | 100   |                                   | 100   | false     | 100 |

  Scenario Outline: max_line_chars cuts the text of each line
    Given k-context-cli-contract: a checkout file "wide.txt" with the content:
      """
      abcdef
      """
    When k-context-cli-contract: I send the request:
      """
      {"version": 1, "root": "{root}", "operation": "search", "literal": "def", "limits": {"max_line_chars": <max>}}
      """
    Then k-context-cli-contract: the request succeeds with the packet:
      """
      {"version":1,"operation":"search","query":"def","matches":[{"path":"wide.txt","line":1,"column":4,"text":"<text>"}],"truncated":false,"limits":{"max_matches":100,"max_line_chars":<max>}}
      """

    Examples:
      | max | text   |
      | 1   | a      |
      | 5   | abcde  |
      | 6   | abcdef |
      | 7   | abcdef |

  Scenario Outline: A read request keeps at most max_line_chars characters of each line
    Given k-context-cli-contract: a checkout file "wide.txt" holding one line of <length> "x" characters
    When k-context-cli-contract: I send the request:
      """
      {"version": 1, "root": "{root}", "operation": "read", "path": "wide.txt", "start": 1, "end": 1<limits>}
      """
    Then k-context-cli-contract: the request succeeds with line 1 of "wide.txt" as <count> "x" characters, max line chars <max>

    Examples:
      | length | limits                              | count | max |
      | 501    |                                     | 500   | 500 |
      | 501    | , "limits": {"max_line_chars": 500} | 500   | 500 |
      | 500    | , "limits": {"max_line_chars": 500} | 500   | 500 |
      | 3      | , "limits": {"max_line_chars": 2}   | 2     | 2   |

  Scenario: A read request returns its range with the default limits
    Given k-context-cli-contract: a checkout file "src/notes.txt" of 3 lines each containing "word"
    When k-context-cli-contract: I send the request:
      """
      {"version": 1, "root": "{root}", "operation": "read", "path": "./src/../src/notes.txt", "start": 2, "end": 3}
      """
    Then k-context-cli-contract: the request succeeds with lines 2 to 3 of 3 in "src/notes.txt", max lines 200 and max line chars 500

  Scenario Outline: max_lines bounds the lines a read request may ask for
    Given k-context-cli-contract: a checkout file "notes.txt" of <total> lines each containing "word"
    When k-context-cli-contract: I send the request:
      """
      {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": <start>, "end": <end><limits>}
      """
    Then k-context-cli-contract: the request succeeds with lines <start> to <end> of <total> in "notes.txt", max lines <max> and max line chars 500

    Examples:
      | total | start | end | limits                         | max |
      | 3     | 2     | 2   | , "limits": {"max_lines": 1}   | 1   |
      | 3     | 1     | 3   | , "limits": {"max_lines": 3}   | 3   |
      | 200   | 1     | 200 |                                | 200 |
      | 250   | 51    | 250 | , "limits": {"max_lines": 200} | 200 |

  Scenario Outline: Requests that cannot be served are refused with an error packet
    Given k-context-cli-contract: a checkout file "notes.txt" of 2 lines each containing "word"
    And k-context-cli-contract: a checkout file "dir/inner.txt" with the content:
      """
      inner
      """
    When k-context-cli-contract: I send the request:
      """
      <request>
      """
    Then k-context-cli-contract: the request is refused with exit status <status>, code "<code>" and message "<message>"

    Examples:
      | request | status | code | message |
      | not json | 2 | invalid_request | request is not one valid JSON object |
      | {"version": 1, "root": "{root}", "operation": "search", "literal": "word"} {} | 2 | invalid_request | request is not one valid JSON object |
      | [] | 2 | invalid_request | request is not one valid JSON object |
      | {"root": "{root}", "operation": "search", "literal": "word"} | 2 | unsupported_version | request version must be 1 |
      | {"version": 2, "root": "{root}", "operation": "search", "literal": "word"} | 2 | unsupported_version | request version must be 1 |
      | {"version": "1", "root": "{root}", "operation": "search", "literal": "word"} | 2 | unsupported_version | request version must be 1 |
      | {"version": 1, "root": "{root}", "operation": "search", "literal": ""} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "search"} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "", "operation": "search", "literal": "word"} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "find", "literal": "word"} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "search", "literal": "word", "extra": true} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "search", "literal": "word", "limits": {"max_matches": 0}} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "search", "literal": "word", "limits": {"max_matches": 101}} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "search", "literal": "word", "limits": {"max_line_chars": 0}} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "search", "literal": "word", "limits": {"max_lines": 5}} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": 0, "end": 1} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": "1", "end": 1} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": 1.5, "end": 2} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": 1, "end": 1, "limits": {"max_lines": 201}} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": 1, "end": 1, "limits": {"max_line_chars": 501}} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": 1, "end": 1, "limits": {"max_matches": 5}} | 2 | invalid_request | request does not match the version 1 request schema |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": 3, "end": 2} | 1 | invalid_range | start line 3 is after end line 2 |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": 1, "end": 201} | 1 | invalid_range | line range 1-201 exceeds the 200-line read limit |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": 1, "end": 3, "limits": {"max_lines": 2}} | 1 | invalid_range | line range 1-3 exceeds the 2-line read limit |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "notes.txt", "start": 2, "end": 3} | 1 | invalid_range | line range 2-3 exceeds the file's line count 2 |
      | {"version": 1, "root": "{root}/missing", "operation": "search", "literal": "word"} | 1 | root_not_directory | checkout root is not a directory: {root}/missing |
      | {"version": 1, "root": "{root}/notes.txt", "operation": "read", "path": "notes.txt", "start": 1, "end": 1} | 1 | root_not_directory | checkout root is not a directory: {root}/notes.txt |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "../outside.txt", "start": 1, "end": 1} | 1 | path_outside_root | path escapes the checkout root: ../outside.txt |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "missing.txt", "start": 1, "end": 1} | 1 | not_found | file not found: missing.txt |
      | {"version": 1, "root": "{root}", "operation": "read", "path": "dir", "start": 1, "end": 1} | 1 | not_a_file | not a regular file: dir |

  Scenario: An empty request is refused with an error packet
    When k-context-cli-contract: I send the request bytes ""
    Then k-context-cli-contract: the request is refused with exit status 2, code "invalid_request" and message "request is not one valid JSON object"

  Scenario: The request command sits next to the unchanged search and read commands
    Given k-context-cli-contract: a checkout file "b.txt" with the content:
      """
      find me
      """
    When k-context-cli-contract: I send the request:
      """
      {"version": 1, "root": "{root}", "operation": "read", "path": "b.txt", "start": 1, "end": 1}
      """
    Then k-context-cli-contract: the request succeeds with the packet:
      """
      {"version":1,"operation":"read","path":"b.txt","start":1,"end":1,"total_lines":1,"lines":[{"line":1,"text":"find me"}],"limits":{"max_lines":200,"max_line_chars":500}}
      """
    When k-context-cli-contract: I run kogen-context with arguments '["search", "{root}", "find"]'
    Then k-context-cli-contract: the command succeeds with the unversioned output:
      """
      {"query":"find","matches":[{"path":"b.txt","line":1,"column":1,"text":"find me"}],"truncated":false}
      """
    When k-context-cli-contract: I run kogen-context with arguments '["read", "{root}", "b.txt", "1", "1"]'
    Then k-context-cli-contract: the command succeeds with the unversioned output:
      """
      {"path":"b.txt","start":1,"end":1,"total_lines":1,"lines":[{"line":1,"text":"find me"}]}
      """
    When k-context-cli-contract: I run kogen-context with arguments '["request", "extra"]'
    Then k-context-cli-contract: the command fails on stderr with exit status 2, code "usage" and message "usage: kogen-context search ROOT LITERAL or kogen-context read ROOT PATH START END"
