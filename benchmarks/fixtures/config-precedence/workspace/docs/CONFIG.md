# Configuration

`loadConfig(fileConfig, env)` produces the effective configuration from three
layers.

## Precedence

Later layers win:

1. Built-in defaults (`src/defaults.js`)
2. The config file
3. Environment variables

## Environment variables

Only variables prefixed `APP_` are considered. The remainder of the name maps to
a config key by lowercasing it and converting `__` to a nesting separator:

| Variable | Key |
|---|---|
| `APP_PORT` | `port` |
| `APP_CACHE__TTL` | `cache.ttl` |
| `APP_CACHE__ENABLED` | `cache.enabled` |

Variables that do not correspond to a key already present in the merged
defaults-plus-file result are **ignored**. This keeps unrelated `APP_`-prefixed
variables in the environment from injecting stray config keys.

### Unset and empty values

A variable that is **unset** or set to the **empty string** does not override
anything: the value from the file, or from the defaults, is used instead. This
is what makes `APP_PORT= my-command` fall back rather than blank the port.

### Coercion

Environment values arrive as strings and are coerced to match the type of the
value they are overriding:

- If the existing value is a **number**, the variable is parsed as a number. A
  value that does not parse to a finite number is ignored.
- If the existing value is a **boolean**, `"true"` and `"1"` mean `true`,
  `"false"` and `"0"` mean `false`, and anything else is ignored.
- Otherwise the string is used unchanged.

## Merging

The file layer merges into the defaults **deeply**:

- Nested plain objects merge key by key.
- **Arrays replace** rather than concatenate, so a file can shorten a list.
- A file value of `undefined` does not override; a value of `null` does.

## Immutability

`loadConfig` must not mutate `fileConfig`, `env`, or the exported defaults
object. Callers reuse all three.
