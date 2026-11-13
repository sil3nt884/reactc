import React from 'react';
// Deliberate mistake: a client file importing server code. reactc must refuse it.
import { DATABASE_PASSWORD } from '../server/secrets.js';

export default function Leaky() {
  return <main><p>{DATABASE_PASSWORD}</p></main>;
}
