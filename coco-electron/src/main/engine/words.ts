// Lexical command splitting. Port of engine/words.rs: shell-style word rules,
// but the split is lexical only — no shell runs, nothing expands.

export function splitCommand(input: string): string[] {
  const words: string[] = []
  let current = ''
  let inWord = false
  let i = 0

  const fail = (message: string): never => {
    throw new Error(message)
  }

  while (i < input.length) {
    const c = input[i]
    i += 1
    if (c === "'") {
      inWord = true
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
      if (!closed) fail('unclosed single quote')
    } else if (c === '"') {
      inWord = true
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
      if (escaped) fail('bad escape at end of input')
      if (!closed) fail('unclosed double quote')
    } else if (c === '\\') {
      inWord = true
      if (i >= input.length) fail('bad escape at end of input')
      current += input[i]
      i += 1
    } else if (/\s/.test(c)) {
      if (inWord) {
        words.push(current)
        current = ''
        inWord = false
      }
    } else {
      inWord = true
      current += c
    }
  }

  if (inWord) words.push(current)
  return words
}
