# @reactc/ui

React components for apps built with reactc. The package exports TypeScript and
TSX source, which reactc compiles into the application with its React runtime.

In this repository, `npm ci` links the workspace package. In a separate app,
install from the checkout with `npm install /path/to/reactc/packages/reactc-ui`.
Use React's type definitions in projects that type-check their TSX.

```tsx
import { useState } from 'react';
import { Button, Panel, TextField } from '@reactc/ui';

export default function App() {
  const [name, setName] = useState('');
  return (
    <Panel style={{ borderColor: '#5c9bff', borderWidth: 2 }}>
      <TextField id="name" label="Name" value={name} onValueChange={setName} />
      <Button disabled={!name} onClick={() => setName('')}>Clear</Button>
    </Panel>
  );
}
```

- `Stack` and `Row` lay out children vertically and horizontally. `Panel` adds
  padding and a border. Each accepts inline style overrides.
- `TextField` is a controlled text input with an associated label, optional
  disabled and read-only states, and separate styles for the field and input.
- `Button` accepts a click callback, disabled state, and an accessible label
  for icon-only controls.
- On Windows, `WindowTitleBar` replaces the default caption with React content.
  `WindowButton` provides minimize, maximize or restore, close, and license
  commands. Put buttons in a relative container and position them with inline
  styles. The Windows host uses the resulting bounds for hit testing.

The renderer determines which style properties are available. See the
[compiler guide](../../compiler/README.md) and
[greeting editor example](../../examples/reactc-ui.tsx).

```sh
reactc build examples/reactc-ui.tsx --target host --outdir dist/reactc-ui-rust-host
reactc build examples/reactc-ui.tsx --target windows --name ReactcUiExample \
  --title "Greeting editor" --outdir dist/reactc-ui-windows
python3 scripts/check-reactc-ui.py dist/reactc-ui-rust-host/app \
  --windows dist/reactc-ui-windows/ReactcUiExample.exe
```

Omit `--windows` when testing the native core without a Windows desktop.
