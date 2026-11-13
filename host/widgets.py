"""Small Tk renderer for the versioned native UI tree. No HTML engine."""
import math
import tkinter as tk
from tkinter import ttk


def text_of(node):
    return node.get('props', {}).get('text', '') + ''.join(text_of(child) for child in node.get('children', []))


class NativeRenderer:
    def __init__(self, root, on_event):
        self.root, self.on_event = root, on_event
        self.widgets, self.variables, self.nodes, self.parents, self.types = {}, {}, {}, {}, {}
        self.muted = False
        self.route = None
        self.last_snapshot = None
        self.row_layout = False
        self.style = ttk.Style(root)
        self.canvas = tk.Canvas(root, highlightthickness=0)
        self.scrollbar = ttk.Scrollbar(root, orient='vertical', command=self.canvas.yview)
        self.canvas.configure(yscrollcommand=self.scrollbar.set)
        self.scrollbar.pack(side='right', fill='y')
        self.canvas.pack(side='left', fill='both', expand=True)
        self.body = ttk.Frame(self.canvas, style='Native.TFrame')
        self.inner = self.canvas.create_window((0, 0), window=self.body, anchor='nw')
        self.body.bind('<Configure>', lambda _: self.canvas.configure(scrollregion=self.canvas.bbox('all')))
        self.canvas.bind('<Configure>', self.resize)
        root.bind('<MouseWheel>', lambda e: self.canvas.yview_scroll(-int(e.delta / 120), 'units'))
        root.bind('<Button-4>', lambda _: self.canvas.yview_scroll(-1, 'units'))
        root.bind('<Button-5>', lambda _: self.canvas.yview_scroll(1, 'units'))

    def resize(self, event):
        self.canvas.itemconfigure(self.inner, width=event.width)
        for key, widget in self.widgets.items():
            if self.types[key] in ('Text', 'Label', 'Heading'):
                widget.configure(wraplength=max(120, event.width - 140))
        row_layout = event.width >= 560
        if row_layout != self.row_layout:
            self.row_layout = row_layout
            if self.last_snapshot:
                self.apply(self.last_snapshot)

    def drop(self, key):
        if key in self.widgets:
            try:
                self.widgets.pop(key).destroy()
            except tk.TclError:
                pass
        self.variables.pop(key, None)
        self.parents.pop(key, None)
        self.types.pop(key, None)

    def event(self, key, kind, value=None):
        if not self.muted and key in self.nodes:
            self.on_event(key, kind, value)

    def create(self, node, parent):
        key, kind, props = node['id'], node['type'], node['props']
        if kind == 'Container':
            return ttk.Frame(parent, style='Native.TFrame', padding=props.get('style', {}).get('padding', 0))
        if kind in ('Text', 'Label', 'Heading'):
            return ttk.Label(parent, style='Native.TLabel', wraplength=max(120, self.canvas.winfo_width()-140), justify='left')
        if kind == 'Button':
            return ttk.Button(parent, style='Native.TButton', command=lambda: self.event(key, 'press'))
        if kind == 'Input':
            variable = tk.StringVar()
            self.variables[key] = variable
            widget = ttk.Entry(parent, textvariable=variable, show='•' if props.get('type') == 'password' else '')
            variable.trace_add('write', lambda *_: self.event(key, 'change', variable.get()))
            return widget
        if kind == 'Select':
            variable = tk.StringVar()
            self.variables[key] = variable
            widget = ttk.Combobox(parent, textvariable=variable, state='readonly')
            def choose(_):
                options = self.nodes[key]['children']
                for option in options:
                    if text_of(option) == variable.get():
                        self.event(key, 'change', str(option['props']['value']))
                        return
            widget.bind('<<ComboboxSelected>>', choose)
            return widget
        if kind == 'TextArea':
            widget = tk.Text(parent, height=4, wrap='word')
            def modified(_):
                if key in self.nodes and widget.edit_modified():
                    widget.edit_modified(False)
                    self.event(key, 'change', widget.get('1.0', 'end-1c'))
            widget.bind('<<Modified>>', modified)
            return widget
        if kind == 'Chart':
            widget = tk.Canvas(parent, height=160, highlightthickness=0)
            widget.bind('<Configure>', lambda _: self.draw_chart(key))
            return widget
        raise RuntimeError('Unsupported native widget: ' + kind)

    def draw_chart(self, key):
        if key not in self.nodes or key not in self.widgets:
            return
        widget, props = self.widgets[key], self.nodes[key]['props']
        widget.delete('all')
        raw = props.get('values', [])[-12:]
        values = [float(v) if isinstance(v, (float, int)) and math.isfinite(v) else 0 for v in raw]
        labels = props.get('labels', [])[-12:]
        width = max(widget.winfo_width(), 240)
        if not values:
            widget.create_text(width/2, 65, text='No chart data', fill=self.foreground)
            return
        maximum = max(max(values), 1)
        step = (width-40)/len(values)
        for index, value in enumerate(values):
            x = 20 + index*step
            y = 130 - max(value, 0)/maximum*105
            widget.create_rectangle(x+3, y, x+step-3, 130, fill='#3987ef', outline='')
            widget.create_text(x+step/2, max(y-8, 8), text=str(value).rstrip('0').rstrip('.') if value else '0', fill=self.foreground)
            widget.create_text(x+step/2, 145, text=str(labels[index])[-5:] if index < len(labels) else '', fill=self.foreground, font=('TkDefaultFont', 8))

    def apply(self, snapshot):
        self.last_snapshot = snapshot
        self.muted = True
        old_nodes = self.nodes
        self.nodes = {}
        props = snapshot['tree']['props']
        scale = float(props.get('data-font-scale', '1'))
        contrast = props.get('data-high-contrast', False)
        self.foreground = '#ffffff' if contrast else '#17202a'
        background = '#101010' if contrast else '#f2f4f7'
        self.style.configure('Native.TFrame', background=background)
        self.style.configure('Native.TLabel', background=background, foreground=self.foreground, font=('TkDefaultFont', int(11*scale)))
        self.style.configure('Native.TButton', font=('TkDefaultFont', int(11*scale)))
        self.canvas.configure(background=background)
        try:
            def render(node, parent, parent_id):
                key, kind, props = node['id'], node['type'], node['props']
                self.nodes[key] = node
                if key in self.widgets and (self.types[key] != kind or self.parents[key] != parent_id):
                    self.drop(key)
                if key not in self.widgets:
                    self.widgets[key] = self.create(node, parent)
                    self.types[key], self.parents[key] = kind, parent_id
                widget = self.widgets[key]
                if kind == 'Container':
                    widget.configure(padding=props.get('style', {}).get('padding', 0))
                if kind in ('Text', 'Label', 'Heading', 'Button'):
                    widget.configure(text=text_of(node))
                    if kind == 'Heading':
                        widget.configure(font=('TkDefaultFont', int(18*scale), 'bold'))
                if kind in ('Input', 'TextArea', 'Select', 'Button'):
                    if kind == 'Input':
                        if self.variables[key].get() != str(props.get('value', '')):
                            self.variables[key].set(props.get('value', ''))
                        widget.configure(font=('TkDefaultFont', int(11*scale)))
                    if kind == 'Select':
                        options = node['children']
                        widget.configure(values=[text_of(option) for option in options], font=('TkDefaultFont', int(11*scale)))
                        selected = next((text_of(option) for option in options if str(option['props']['value']) == str(props.get('value'))), '')
                        self.variables[key].set(selected)
                    if kind == 'TextArea':
                        if widget.get('1.0', 'end-1c') != props.get('value', ''):
                            widget.configure(state='normal')
                            widget.delete('1.0', 'end')
                            widget.insert('1.0', props.get('value', ''))
                            widget.edit_modified(False)
                        widget.configure(font=('TkDefaultFont', int(11*scale)), background='#202020' if contrast else 'white', foreground=self.foreground)
                    state = 'disabled' if props.get('disabled') or (props.get('readOnly') and kind == 'TextArea') else 'readonly' if kind == 'Select' or props.get('readOnly') else 'normal'
                    widget.configure(state=state)
                if kind == 'Chart':
                    widget.configure(background=background)
                    self.draw_chart(key)
                if kind == 'Container':
                    row = props.get('style', {}).get('flexDirection') == 'row' and self.row_layout
                    for child in node['children']:
                        render(child, widget, key)
                        control = self.widgets[child['id']]
                        control.pack_forget()
                        control.pack(side='left' if row else 'top', fill='x', expand=row, pady=4, padx=2)
            render(snapshot['tree'], self.body, 'host-root')
            self.widgets[snapshot['tree']['id']].pack(fill='both', expand=True)
            for key in list(self.widgets):
                if key not in self.nodes:
                    self.drop(key)
            route = props.get('data-route')
            if route != self.route:
                self.canvas.yview_moveto(0)
                self.route = route
        except Exception:
            self.nodes = old_nodes
            raise
        finally:
            self.muted = False
