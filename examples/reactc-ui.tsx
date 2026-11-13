import { useState } from 'react';
import { Button, Panel, Row, Stack, TextField, WindowButton, WindowTitleBar } from '@reactc/ui';

export default function ReactcUiExample() {
  const [name, setName] = useState('');
  const [greeting, setGreeting] = useState('');

  return <main style={{ flexDirection: 'column', gap: 0 }}>
    <WindowTitleBar style={{ paddingLeft: 16, borderBottomWidth: 2, borderColor: '#5c9bff' }}>
      <span style={{ flexGrow: 1 }}>Greeting editor</span>
      <WindowButton command="minimize" />
      <WindowButton command="maximize" />
      <WindowButton command="close" style={{ marginRight: 8, paddingLeft: 10 }} />
    </WindowTitleBar>
    <Stack style={{ padding: 16 }}>
      <Panel id="greeting-panel" style={{ borderColor: '#5c9bff', borderWidth: 2 }}>
        <TextField id="name" label="Name" value={name} onValueChange={setName} />
        <Row id="greeting-actions">
          <Button id="greet" disabled={!name.trim()} onClick={() => setGreeting('Hello, ' + name.trim() + '!')}>
            Greet
          </Button>
          <Button id="clear" onClick={() => { setName(''); setGreeting(''); }}>Clear</Button>
        </Row>
        <p id="greeting" role="status">{greeting || 'Enter your name.'}</p>
      </Panel>
    </Stack>
  </main>;
}
