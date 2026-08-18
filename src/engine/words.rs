//! Lexical command splitting.
//!
//! Manifest `command` values are split with shell-style word rules — quotes
//! and backslash escapes group characters — but the split is **lexical only**:
//! no shell runs, nothing expands, and the result is an argv list
//! (convention §2, §3).

/// Splits a `command` string into argv words.
///
/// Rules:
/// - unquoted whitespace separates words;
/// - single quotes group literally until the closing quote;
/// - double quotes group literally, with `\` escaping the next character;
/// - a backslash outside quotes escapes the next character;
/// - an unclosed quote or a trailing backslash is an error (the manifest
///   must not load).
pub fn split_command(input: &str) -> Result<Vec<String>, String> {
    let mut words: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut in_word = false;
    let mut chars = input.chars();

    while let Some(c) = chars.next() {
        match c {
            '\'' => {
                in_word = true;
                let mut closed = false;
                for c in chars.by_ref() {
                    if c == '\'' {
                        closed = true;
                        break;
                    }
                    current.push(c);
                }
                if !closed {
                    return Err("unclosed single quote".to_owned());
                }
            }
            '"' => {
                in_word = true;
                let mut closed = false;
                let mut escaped = false;
                for c in chars.by_ref() {
                    if escaped {
                        current.push(c);
                        escaped = false;
                        continue;
                    }
                    match c {
                        '"' => {
                            closed = true;
                            break;
                        }
                        '\\' => escaped = true,
                        c => current.push(c),
                    }
                }
                if escaped {
                    return Err("bad escape at end of input".to_owned());
                }
                if !closed {
                    return Err("unclosed double quote".to_owned());
                }
            }
            '\\' => {
                in_word = true;
                match chars.next() {
                    Some(escaped) => current.push(escaped),
                    None => return Err("bad escape at end of input".to_owned()),
                }
            }
            c if c.is_whitespace() => {
                if in_word {
                    words.push(std::mem::take(&mut current));
                    in_word = false;
                }
            }
            c => {
                in_word = true;
                current.push(c);
            }
        }
    }

    if in_word {
        words.push(current);
    }
    Ok(words)
}

#[cfg(test)]
mod tests {
    use super::split_command;

    #[test]
    fn splits_plain_words() {
        assert_eq!(
            split_command("python3 tools/report.py --strict").unwrap(),
            ["python3", "tools/report.py", "--strict"]
        );
    }

    #[test]
    fn groups_quoted_text() {
        assert_eq!(
            split_command("prog 'a b' \"c d\" e").unwrap(),
            ["prog", "a b", "c d", "e"]
        );
    }

    #[test]
    fn backslash_escapes_characters() {
        assert_eq!(split_command("prog a\\ b\\ c").unwrap(), ["prog", "a b c"]);
    }

    #[test]
    fn keeps_empty_quoted_words() {
        assert_eq!(split_command("prog \"\" ''").unwrap(), ["prog", "", ""]);
    }

    #[test]
    fn collapses_leading_and_trailing_whitespace() {
        assert_eq!(split_command("  a  b  ").unwrap(), ["a", "b"]);
    }

    #[test]
    fn rejects_unclosed_quotes() {
        assert!(split_command("prog 'oops").is_err());
        assert!(split_command("prog \"oops").is_err());
    }

    #[test]
    fn rejects_trailing_backslash() {
        assert!(split_command("prog \\").is_err());
    }

    #[test]
    fn empty_input_has_no_words() {
        assert_eq!(split_command("").unwrap(), Vec::<String>::new());
        assert_eq!(split_command("   ").unwrap(), Vec::<String>::new());
    }
}
