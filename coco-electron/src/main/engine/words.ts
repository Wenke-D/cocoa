// Lexical command splitting: shell-style word rules, but the split is lexical
// only — no shell runs, nothing expands.

export function split_command(input: string): string[] {
  const words: string[] = []
  let current = ''
  let in_word = false
  let i = 0

  const fail = (message: string): never => {
    throw new Error(message)
  }

  while (i < input.length) {
    const c = input[i]
    i += 1
    if (c === "'") {
      in_word = true
      let closed = false
      while (i < input.length) {
        const q = input[i]
        i += 1
        if (q === "'") {
          closed = true
          break
        }
        current += q
      }
      if (!closed) {
        fail('unclosed single quote')
      }
    } else if (c === '"') {
      in_word = true
      let closed = false
      let escaped = false
      while (i < input.length) {
        const q = input[i]
        i += 1
        if (escaped) {
          current += q
          escaped = false
          continue
        }
        if (q === '"') {
          closed = true
          break
        }
        if (q === '\\') {
          escaped = true
          continue
        }
        current += q
      }
      if (escaped) {
        fail('bad escape at end of input')
      }
      if (!closed) {
        fail('unclosed double quote')
      }
    } else if (c === '\\') {
      in_word = true
      if (i >= input.length) {
        fail('bad escape at end of input')
      }
      current += input[i]
      i += 1
    } else if (/\s/.test(c)) {
      if (in_word) {
        words.push(current)
        current = ''
        in_word = false
      }
    } else {
      in_word = true
      current += c
    }
  }

  if (in_word) {
    words.push(current)
  }
  return words
}
