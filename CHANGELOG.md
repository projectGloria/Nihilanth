# Changelog

## 0.1.5

- Add a matching dragon-head extension icon and clickable bottom-right status-bar icon.
- Include the optional Nihilanth Dragon product icon theme for dragon-head Event suggestions.

## 0.1.4

- Collapse saved versions into one name suggestion and one code suggestion per identifier.
- Prefer the latest complete declaration from the current file, then the current project. Skip incomplete automatic captures in completion lists and preserve all stored history.

## 0.1.3

- Use VS Code's lightning Event icon for all Nihilanth suggestions, replacing the rabbit badge.

## 0.1.2

- Mark every toolbox completion with a rabbit icon and Nihilanth label beside the suggestion name.

## 0.1.1

- Refresh an already open VS Code suggestion list when a remembered name matches two typed characters. Recall now joins built-in suggestions at `Ni` instead of waiting for the full name.
- Add an integration regression test with normal quick suggestions enabled and separate `N` / `i` typing.

## 0.1.0

- Automatic, case-insensitive declaration recall from two typed characters, offering both the name and complete saved code.
- Editor slash commands and a configurable keyboard shortcut.
- Local code memory with shared project history and persistent pins.
- Dummy data from presets, local types, and literal examples.
- Selection transformations for JSON, objects, arrays, names, and TypeScript types.
- Configurable capture exclusions, automatic-history cap, and management commands.
