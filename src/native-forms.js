// Native text fields use the same ordered, repeatable form values as FormData.
export class FormTarget {
  constructor(entries, reset) {
    this.entries = entries;
    this.reset = reset;
  }
}

class NativeTextFormData {
  constructor(target) {
    if (target !== undefined && !(target instanceof FormTarget)) {
      throw new TypeError('FormData requires a native form target');
    }
    this.fields = target ? target.entries.map(entry => entry.slice()) : [];
  }

  append(name, value) {
    if (arguments.length !== 2 || (value !== null && typeof value === 'object')) {
      throw new TypeError('Native forms support text values');
    }
    this.fields.push([String(name), String(value)]);
  }

  get(name) {
    const field = this.fields.find(entry => entry[0] === String(name));
    return field ? field[1] : null;
  }

  getAll(name) {
    return this.fields.filter(entry => entry[0] === String(name)).map(entry => entry[1]);
  }

  has(name) {
    return this.fields.some(entry => entry[0] === String(name));
  }

  delete(name) {
    this.fields = this.fields.filter(entry => entry[0] !== String(name));
  }

  set(name, value) {
    if (arguments.length !== 2 || (value !== null && typeof value === 'object')) {
      throw new TypeError('Native forms support text values');
    }
    name = String(name);
    const index = this.fields.findIndex(entry => entry[0] === name);
    if (index < 0) this.append(name, value);
    else {
      this.fields[index][1] = String(value);
      this.fields = this.fields.filter((entry, i) => entry[0] !== name || i === index);
    }
  }

  entries() {
    return this.fields.values();
  }

  [Symbol.iterator]() {
    return this.entries();
  }
}

export { NativeTextFormData as FormData };

export function runFormAction(state, data, perform, onComplete, onError) {
  if (state.pending) throw new Error('A form submission is already pending');
  state.pending = true;
  state.data = data;
  function finish() {
    state.pending = false;
    state.data = null;
  }
  void Promise.resolve().then(perform).then(value => {
    finish();
    onComplete(value);
  }, error => {
    finish();
    onError(error);
  });
}

function numberConstraint(value) {
  const text = String(value ?? '');
  if (!/^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function validationMessage(field) {
  if (!field.value) return field.required ? 'Fill in this field.' : null;
  if (field.type === 'email' && !/^[^\s@]+@[^\s@]+$/.test(field.value)) {
    return 'Enter a valid email address.';
  }
  // Date and time fields are typed in the ISO form a browser control submits.
  if (field.type === 'date' || field.type === 'datetime-local' || field.type === 'time') {
    const shape = field.type === 'date' ? /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/
      : field.type === 'time' ? /^()()()([0-9]{2}):([0-9]{2})$/
      : /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})$/;
    const parts = shape.exec(field.value);
    const example = field.type === 'date' ? 'YYYY-MM-DD' : field.type === 'time' ? 'HH:MM' : 'YYYY-MM-DDTHH:MM';
    if (!parts) return 'Enter this as ' + example + '.';
    if (field.type !== 'time') {
      const year = Number(parts[1]), month = Number(parts[2]), day = Number(parts[3]);
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
      if (year < 1 || !days || day < 1 || day > days) return 'Enter a real date.';
    }
    if (field.type !== 'date' && (Number(parts[4]) > 23 || Number(parts[5]) > 59)) return 'Enter a real time.';
    if (typeof field.min === 'string' && field.min && field.value < field.min) return 'Enter a value no earlier than ' + field.min + '.';
    if (typeof field.max === 'string' && field.max && field.value > field.max) return 'Enter a value no later than ' + field.max + '.';
    return null;
  }
  if (field.type !== 'number') return null;
  const number = numberConstraint(field.value);
  if (number === null) return 'Enter a number.';
  const min = numberConstraint(field.min);
  const max = numberConstraint(field.max);
  if (min !== null && number < min) return 'Enter a number of at least ' + min + '.';
  if (max !== null && number > max) return 'Enter a number no greater than ' + max + '.';
  if (field.step !== 'any') {
    const step = numberConstraint(field.step);
    const steps = (number - (min ?? 0)) / (step > 0 ? step : 1);
    if (Math.abs(steps - Math.round(steps)) > 1e-7) return 'Enter a value that matches the field step.';
  }
  return null;
}

export function submitForm(form, submitter) {
  if (form.status.pending) throw new Error('A form submission is already pending');
  form.storage.invalid = null;
  if (!form.noValidate) {
    for (const field of form.validatedFields) {
      const message = validationMessage(field);
      if (message) {
        form.storage.invalid = { path: field.path, message };
        return;
      }
    }
  }
  function reset() {
    form.storage.values = {};
    form.storage.invalid = null;
    form.changed();
  }
  const target = new FormTarget(form.fields, reset);
  const event = {
    currentTarget: target,
    target,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  function observe(result) {
    if (result && typeof result.then === 'function') void result.then(undefined, form.reportError);
  }
  if (form.onSubmitCapture) observe(form.onSubmitCapture(event));
  if (form.onSubmit) observe(form.onSubmit(event));
  if (event.defaultPrevented) return;
  if (!form.action) throw new Error('Native submit handlers must prevent default form navigation');

  const data = new NativeTextFormData(target);
  if (submitter.name) data.append(submitter.name, submitter.value ?? '');
  if (form.action.state) form.action(data, reset);
  else runFormAction(form.status, data, () => form.action(data), reset, form.reportError);
}
