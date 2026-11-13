"""Skia raster renderer for the native page protocol; no browser or JS engine.

A small measured row/column layout, not CSS/Yoga. Native Tk editors provide
selection, keyboard input and IME; the inactive controls and all chrome use Skia.
"""
import json
import os
from dataclasses import dataclass, field
from pathlib import Path
import skia

THEME = json.loads((Path(__file__).resolve().parents[1] / 'design/web-theme.json').read_text())
FONT_FAMILY='Segoe UI' if os.name=='nt' else THEME['fontFamily']


def text_of(node):
    return str(node.get('props', {}).get('text', '')) + ''.join(text_of(c) for c in node.get('children', []))


def walk(node):
    yield node
    for child in node.get('children', []):
        yield from walk(child)


@dataclass
class Box:
    node: dict
    x: float
    y: float
    w: float
    h: float
    children: list = field(default_factory=list)
    text_size: float = 0
    text_bold: bool = False
    line_height: float = 1.35

    @property
    def outer_height(self):
        style=self.node.get('props',{}).get('style',{})
        return self.h+style.get('marginTop',style.get('margin',0))+style.get('marginBottom',style.get('margin',0))

    def contains(self, x, y):
        return self.x <= x < self.x+self.w and self.y <= y < self.y+self.h


class Scene:
    """Layout and paint share bounds for clipping, hit testing and native editors."""
    def __init__(self, snapshot, width=390, height=844, scroll=0, hover=None, pressed=None):
        self.snapshot, self.width, self.height = snapshot, width, height
        self.colors = dict(THEME['colors'])
        self.scale = float(snapshot['tree']['props'].get('data-font-scale', 1))
        self.contrast = snapshot['tree']['props'].get('data-high-contrast', False)
        if self.contrast:
            self.colors.update({'canvas':'#000000','surface':'#101010','foreground':'#ffffff','muted':'#dddddd','border':'#999999'})
        self.fonts = {}
        self.hover,self.pressed=hover,pressed
        self.opacity=1
        self.hits, self.boxes = [], {}
        nodes = list(walk(snapshot['tree']))
        self.tabs = next((n for n in nodes if n['props'].get('data-ui') == 'tab-bar'), None)
        self.route = snapshot['tree']['props'].get('data-route', '')
        self.header_height, self.footer_height = 36, 76 if self.tabs else 0
        content = []
        for node in snapshot['tree']['children']:
            if node['props'].get('data-ui') == 'app-header':
                back = next((n for n in walk(node) if n['props'].get('id') == 'navigate-back'), None)
                if back:
                    content.append(back)
            elif node['props'].get('id') != 'app-status' or text_of(node) not in ('Ready','Done',''):
                content.append(node)
        self.content_width = min(width, 576)
        self.left = (width-self.content_width)/2 + 20
        available = self.content_width-40
        y = 16
        self.content = []
        for node in content:
            box = self.layout(node, self.left, y, available)
            self.content.append(box)
            y += box.outer_height+16
        self.content_height = y
        self.viewport_height = height-self.header_height-self.footer_height
        self.max_scroll = max(0, y-self.viewport_height)
        self.scroll = min(max(0, scroll), self.max_scroll)

    def font(self, size=16, bold=False):
        key=(size,bold)
        if key not in self.fonts:
            face = skia.Typeface.MakeFromName(FONT_FAMILY, skia.FontStyle.Bold() if bold else skia.FontStyle.Normal())
            self.fonts[key] = skia.Font(face, size*self.scale)
        return self.fonts[key]

    def lines(self, value, width, size=16, bold=False):
        font = self.font(size,bold)
        result=[]
        # Character fallback bounds even unbroken URLs/notes; never widen the page.
        for paragraph in str(value).split('\n'):
            line=''
            for word in paragraph.split(' '):
                candidate=(line+' '+word).lstrip()
                if font.measureText(candidate) <= width:
                    line=candidate
                    continue
                if line:
                    result.append(line)
                line=''
                for char in word:
                    if line and font.measureText(line+char)>width:
                        result.append(line)
                        line=''
                    line+=char
            result.append(line)
        return result or ['']

    def typography(self, node):
        kind, props = node['type'], node['props']
        size,bold,color=(20,True,'foreground') if kind=='Heading' else (13,False,'muted') if kind=='Label' else (14,False,'foreground' if props.get('__nativeSource') else 'muted')
        style=self.node_style(node)
        return style.get('fontSize',size),style.get('fontWeight',700 if bold else 400)>=500,style.get('color',color)

    def node_style(self,node):
        props=node['props'];style=dict(props.get('style',{}))
        if not props.get('disabled'):
            variants=props.get('nativeVariants',{})
            if node['id']==self.hover:
                style.update(variants.get('hover',{}))
            if node['id']==self.pressed:
                style.update(variants.get('active',{}))
        return style

    def layout(self, node, x, y, width, card=False):
        kind, props = node['type'], node['props']
        ui=props.get('data-ui')
        style=self.node_style(node)
        web=bool(props.get('__nativeSource'))
        ml,mr=style.get('marginLeft',style.get('margin',0)),style.get('marginRight',style.get('margin',0))
        x+=ml;y+=style.get('marginTop',style.get('margin',0));width-=ml+mr
        if isinstance(style.get('width'),(int,float)):
            width=min(width,style['width'])
        if isinstance(style.get('maxWidth'),(int,float)):
            width=min(width,style['maxWidth'])
        if kind=='Container':
            padding=style.get('padding',18 if ui=='card' else 0) if web else 18 if ui=='card' else 0
            pl,pr,pt,pb=[style.get('padding'+edge,padding) for edge in ('Left','Right','Top','Bottom')]
            gap=style.get('gap',0) if web else 12 if ui=='card' else 7 if ui=='field' else 14
            row=(style.get('display')=='grid' and style.get('gridColumns')==2) or (style.get('display')=='flex' and style.get('flexDirection','row')=='row') if web else ui=='row' or (style.get('flexDirection')=='row' and width>460)
            children=[]
            if row:
                columns=style.get('gridColumns',max(1,len(node['children'])))
                child_width=(width-pl-pr-gap*(columns-1))/columns
                top=y+pt;row_height=0
                for i,child in enumerate(node['children']):
                    if i and i%columns==0:
                        top+=row_height+gap;row_height=0
                    box=self.layout(child,x+pl+(i%columns)*(child_width+gap),top,child_width)
                    children.append(box);row_height=max(row_height,box.outer_height)
                height=top-y+row_height+pb
            else:
                top=y+pt
                for child in node['children']:
                    box=self.layout(child,x+pl,top,width-pl-pr,ui=='card')
                    children.append(box)
                    top+=box.outer_height+gap
                height=top-y-gap+pb if children else pt+pb
            box=Box(node,x,y,width,max(0,height),children)
        elif kind in ('Text','Label','Heading'):
            size,bold,_=self.typography(node)
            if kind=='Heading' and not card and 'fontSize' not in style:
                size=26
            padding=style.get('padding',0);pl,pr,pt,pb=[style.get('padding'+edge,padding) for edge in ('Left','Right','Top','Bottom')]
            line_height=style.get('lineHeight',1.5 if web else 1.35)
            value=text_of(node)
            height=(0 if web and not value else len(self.lines(value,width-pl-pr,size,bold))*size*self.scale*line_height)+pt+pb
            box=Box(node,x,y,width,height,text_size=size,text_bold=bold,line_height=line_height)
        else:
            h={'Input':48,'Select':48,'TextArea':100,'Button':46,'Chart':160}.get(kind,24)
            if web and kind=='TextArea':
                h=props.get('rows',3)*style.get('fontSize',16)*style.get('lineHeight',1.5)+style.get('paddingTop',0)+style.get('paddingBottom',0)+2*style.get('borderWidth',0)
            h=style.get('height',h)
            if kind=='Button':
                size=style.get('fontSize',14)
                inner=width-style.get('paddingLeft',16)-style.get('paddingRight',16)
                h=max(h,len(self.lines(text_of(node),inner,size,True))*size*style.get('lineHeight',1.35)*self.scale+16)
            box=Box(node,x,y,width,h*self.scale if kind in ('Input','Select','TextArea') else h)
        self.boxes[node['id']]=box
        return box

    def paint(self, color, stroke=None):
        channels=bytes.fromhex(self.colors.get(color,color).lstrip('#'))
        alpha=channels[3] if len(channels)==4 else 255
        p=skia.Paint(Color=skia.ColorSetARGB(int(alpha*self.opacity),*channels[:3]), AntiAlias=True)
        if stroke:
            p.setStyle(skia.Paint.kStroke_Style)
            p.setStrokeWidth(stroke)
        return p

    def rounded(self, canvas, x,y,w,h,r,fill,outline=None):
        rect=skia.Rect.MakeXYWH(x,y,w,h)
        canvas.drawRoundRect(rect,r,r,self.paint(fill))
        if outline:
            canvas.drawRoundRect(rect,r,r,self.paint(outline,1))

    def label(self, canvas, value,x,y,width,size=14,bold=False,color='foreground',center=False,max_lines=None,line_height=1.35):
        lines=self.lines(value,width,size,bold)
        if max_lines and len(lines)>max_lines:
            lines=lines[:max_lines]
            lines[-1]=lines[-1][:-2]+'…'
        font=self.font(size,bold)
        for i,line in enumerate(lines):
            offset=(width-font.measureText(line))/2 if center else 0
            canvas.drawString(line,x+offset,y+size*self.scale+i*size*self.scale*line_height,font,self.paint(color))

    def icon(self, canvas, name,x,y,color='muted',size=22):
        # Small vector icon vocabulary, no icon fonts or remote assets.
        paths={
            'home':[(2,10),(12,2),(22,10),(22,22),(15,22),(15,15),(9,15),(9,22),(2,22),(2,10)],
            'plans':[(6,3),(18,3),(21,6),(21,22),(3,22),(3,3),(6,3),(6,6),(18,6)],
            'schedule':[(3,5),(21,5),(21,22),(3,22),(3,5),(3,10),(21,10)],
            'messages':[(3,3),(21,3),(21,17),(9,17),(3,22),(3,3)],
            'profile':[(3,23),(4,18),(8,15),(16,15),(20,18),(21,23)],
            'back':[(15,3),(6,12),(15,21)],
            'activity':[(1,13),(6,13),(9,3),(14,21),(17,11),(23,11)],
        }
        points=paths.get(name,paths['plans'])
        p=skia.Path()
        for i,(px,py) in enumerate(points):
            (p.moveTo if i==0 else p.lineTo)(x+px*size/24,y+py*size/24)
        canvas.drawPath(p,self.paint(color,1.7))
        if name=='profile':
            canvas.drawCircle(x+size/2,y+size*.31,size*.22,self.paint(color,1.7))
        if name=='schedule':
            for px in (8,16):
                canvas.drawLine(x+px*size/24,y+2*size/24,x+px*size/24,y+8*size/24,self.paint(color,1.7))

    def draw_box(self, canvas, box):
        style=self.node_style(box.node)
        opacity=self.opacity
        self.opacity*=style.get('opacity',1)
        canvas.save()
        scale=style.get('scale',1)
        if scale!=1:
            canvas.translate(box.x+box.w/2,box.y+box.h/2)
            canvas.scale(scale,scale)
            canvas.translate(-box.x-box.w/2,-box.y-box.h/2)
        try:self.draw_content(canvas,box)
        finally:
            canvas.restore();self.opacity=opacity

    def draw_content(self, canvas, box):
        node,x,y,w,h=box.node,box.x,box.y,box.w,box.h
        kind,props=node['type'],node['props']
        style=self.node_style(node)
        web=bool(props.get('__nativeSource'))
        radius=style.get('borderRadius',0)
        border=style.get('borderColor','border') if style.get('borderWidth') else None
        if web and (style.get('backgroundColor') or border):
            if style.get('shadow'):
                self.rounded(canvas,x,y+4,w,h,radius,'#060709')
            self.rounded(canvas,x,y,w,h,radius,style.get('backgroundColor','#00000000'),border)
        if kind=='Container':
            if props.get('data-ui')=='card':
                # The web uses a subtle surface border plus a soft card shadow.
                self.rounded(canvas,x,y+4,w,h,28,'#060709')
                self.rounded(canvas,x,y,w,h,THEME['radii']['card'],'surface','border')
            for child in box.children:
                self.draw_box(canvas,child)
        elif kind in ('Text','Heading','Label'):
            size,bold,color=self.typography(node)
            # Match measured top-level headings.
            if box.text_size:
                size=box.text_size
            padding=style.get('padding',0);pl,pr,pt=[style.get('padding'+edge,padding) for edge in ('Left','Right','Top')]
            self.label(canvas,text_of(node),x+pl,y+pt,w-pl-pr,size,box.text_bold,color,style.get('textAlign')=='center',line_height=box.line_height)
        elif kind in ('Input','TextArea','Select'):
            readonly=props.get('readOnly') or props.get('disabled')
            if not web:self.rounded(canvas,x,y,w,h,THEME['radii']['field'],'surface-2' if readonly else 'surface','border')
            value=props.get('value','')
            if kind=='Select':
                value=next((text_of(c) for c in node['children'] if str(c['props'].get('value'))==str(value)), '')
            if props.get('type')=='password':
                value='•'*len(str(value))
            placeholder=props.get('nativeVariants',{}).get('placeholder',{})
            pl=style.get('paddingLeft',16);pr=style.get('paddingRight',16)
            size=style.get('fontSize',16)
            self.label(canvas,value or props.get('placeholder',''),x+pl,y+style.get('paddingTop',13),w-pl-pr-(20 if kind=='Select' else 0),size,False,style.get('color','muted' if readonly else 'foreground') if value else placeholder.get('color','muted'),max_lines=3 if kind=='TextArea' else 1,line_height=style.get('lineHeight',1.35))
            if kind=='Select' and style.get('appearance')!='none':
                canvas.drawLine(x+w-27,y+22,x+w-22,y+27,self.paint('muted',1.4))
                canvas.drawLine(x+w-22,y+27,x+w-17,y+22,self.paint('muted',1.4))
            if not readonly and style.get('pointerEvents')!='none':
                self.hits.append(box)
        elif kind=='Button':
            back=props.get('id')=='navigate-back'
            if back:
                self.icon(canvas,'back',x,y+4,'accent')
                self.label(canvas,'Back',x+30,y+5,w-30,14,False,'accent')
            else:
                primary=props.get('id','').startswith(('save-','confirm-','send-','login-','signup-'))
                if not web:self.rounded(canvas,x,y,w,h,THEME['radii']['button'],'accent' if primary else 'surface-2')
                size=style.get('fontSize',14);pl=style.get('paddingLeft',16);pr=style.get('paddingRight',16)
                line_height=style.get('lineHeight',1.35)
                content_height=len(self.lines(text_of(node),w-pl-pr,size,True))*size*line_height*self.scale
                self.label(canvas,text_of(node),x+pl,y+(h-content_height)/2,w-pl-pr,size,True,style.get('color','muted' if props.get('disabled') else 'accent-contrast' if primary else 'accent'),center=True,line_height=line_height)
            if not props.get('disabled') and style.get('pointerEvents')!='none':
                self.hits.append(box)
        elif kind=='Chart':
            values=node['props'].get('values',[])
            if not values:
                self.label(canvas,'No chart data',x,y+50,w,14,False,'muted',True)
            else:
                maximum=max(1,max(values)); step=w/len(values)
                for i,value in enumerate(values):
                    bar=max(0,value)/maximum*(h-30)
                    self.rounded(canvas,x+i*step+4,y+h-20-bar,max(1,step-8),bar,4,'accent')

    def draw(self):
        surface=skia.Surface(self.width,self.height)
        canvas=surface.getCanvas()
        canvas.clear(self.paint('canvas').getColor())
        self.hits=[]
        canvas.save()
        canvas.clipRect(skia.Rect.MakeXYWH(0,self.header_height,self.width,self.viewport_height))
        canvas.translate(0,self.header_height-self.scroll)
        for box in self.content:
            self.draw_box(canvas,box)
        canvas.restore()
        # Demo provenance remains visible even after scrolling.
        self.label(canvas,self.snapshot['tree']['props'].get('data-host-banner','LOCAL DEMO  ·  Synthetic data only'),20,9,self.width-40,11,True,'muted')
        if self.tabs:
            y=self.height-self.footer_height
            canvas.drawRect(skia.Rect.MakeXYWH(0,y,self.width,self.footer_height),self.paint('surface'))
            canvas.drawLine(0,y,self.width,y,self.paint('border',1))
            width=self.width/len(self.tabs['children'])
            for i,node in enumerate(self.tabs['children']):
                name=node['props']['id'].removeprefix('nav-')
                active=self.route.split('?')[0].startswith('/'+name)
                color='accent' if active else 'muted'
                self.icon(canvas,name,i*width+width/2-11,y+12,color)
                self.label(canvas,text_of(node),i*width,y+39,width,10,False,color,True)
                self.hits.append(Box(node,i*width,y,width,self.footer_height))
        return surface.makeImageSnapshot()

    def hit(self,x,y):
        for box in reversed(self.hits):
            fixed=box.node['props'].get('id','').startswith('nav-')
            yy=y if fixed else y-self.header_height+self.scroll
            if fixed and y<self.height-self.footer_height:
                continue
            if not fixed and not self.header_height<=y<self.height-self.footer_height:
                continue
            if box.contains(x,yy):
                return box
        return None

    def screen_bounds(self,box):
        return box.x,box.y+self.header_height-self.scroll,box.w,box.h


class SkiaRenderer:
    def __init__(self,root,on_event):
        import tkinter as tk
        from PIL import ImageTk
        self.tk,self.ImageTk,self.root,self.on_event=tk,ImageTk,root,on_event
        self.canvas=tk.Canvas(root,highlightthickness=0,background=THEME['colors']['canvas'],takefocus=True)
        self.canvas.pack(fill='both',expand=True)
        self.canvas.bind('<Configure>',lambda _:self.redraw())
        self.canvas.bind('<Button-1>',self.click)
        self.canvas.bind('<ButtonRelease-1>',self.release)
        self.canvas.bind('<Motion>',self.motion)
        self.canvas.bind('<Leave>',lambda _:self.set_hover(None))
        self.canvas.bind('<MouseWheel>',lambda e:self.scroll_by(-e.delta/120*60))
        self.canvas.bind('<Button-4>',lambda _:self.scroll_by(-60))
        self.canvas.bind('<Button-5>',lambda _:self.scroll_by(60))
        self.canvas.bind('<Tab>',self.tab)
        self.canvas.bind('<Return>',self.activate_focus)
        self.canvas.bind('<space>',self.activate_focus)
        self.canvas.bind('<Down>',lambda _:self.scroll_by(60))
        self.canvas.bind('<Up>',lambda _:self.scroll_by(-60))
        self.snapshot=None
        self.nodes={}
        self.scroll=0
        self.route=None
        self.editor=None
        self.editing=None
        self.focus_id=None
        self.hover=None
        self.pressed=None
        self.muted=False
        self.image_item=self.canvas.create_image(0,0,anchor='nw')

    def apply(self,snapshot):
        self.snapshot=snapshot
        self.nodes={n['id']:n for n in walk(snapshot['tree'])}
        route=snapshot['tree']['props'].get('data-route')
        if route!=self.route:
            self.close_editor()
            self.focus_id=None
            self.hover=None
            self.pressed=None
            self.scroll=0
            self.route=route
        if self.editing and (self.editing not in self.nodes or self.nodes[self.editing]['props'].get('disabled')):
            self.close_editor()
        self.redraw()

    def redraw(self):
        if not self.snapshot:
            return
        from PIL import Image
        width,height=max(320,self.canvas.winfo_width()),max(320,self.canvas.winfo_height())
        self.scene=Scene(self.snapshot,width,height,self.scroll,self.hover,self.pressed)
        self.scroll=self.scene.scroll
        image=self.scene.draw()
        self.photo=self.ImageTk.PhotoImage(Image.fromarray(image.toarray(colorType=skia.ColorType.kRGBA_8888_ColorType)))
        self.canvas.itemconfigure(self.image_item,image=self.photo)
        self.canvas.delete('focus')
        if self.focus_id:
            box=next((b for b in self.scene.hits if b.node['id']==self.focus_id),None)
            if box:
                x,y,w,h=(box.x,box.y,box.w,box.h) if box.node['props'].get('id','').startswith('nav-') else self.scene.screen_bounds(box)
                self.canvas.create_rectangle(x+2,y+2,x+w-2,y+h-2,outline=THEME['colors']['accent'],width=2,tags='focus')
        if self.editing:
            box=self.scene.boxes.get(self.editing)
            if box:
                x,y,w,h=self.scene.screen_bounds(box)
                # A scrolled editor must never obscure fixed bars.
                if y<self.scene.header_height or y+h>height-self.scene.footer_height:
                    self.close_editor()
                else:
                    self.editor.place(x=x+12,y=y+8,width=max(10,w-24),height=h-16)

    def scroll_by(self,delta):
        self.close_editor()
        self.scroll+=delta
        self.redraw()
        return 'break'

    def close_editor(self):
        if self.editor:
            self.editor.destroy()
        self.editor,self.editing=None,None

    def event(self,key,kind,value=None):
        if key in self.nodes and not self.nodes[key]['props'].get('disabled'):
            self.on_event(key,kind,value)

    def click(self,event):
        self.close_editor()
        self.canvas.focus_set()
        box=self.scene.hit(event.x,event.y)
        if box:
            self.focus_id=box.node['id']
            if box.node['type']=='Button':
                self.pressed=box.node['id']
            else:
                self.activate(box)
        self.redraw()

    def release(self,event):
        pressed=self.pressed
        self.pressed=None
        box=self.scene.hit(event.x,event.y)
        if pressed and box and box.node['id']==pressed:
            self.activate(box)
        self.redraw()

    def set_hover(self,key):
        if key!=self.hover:
            self.hover=key
            self.redraw()

    def motion(self,event):
        box=self.scene.hit(event.x,event.y)
        self.set_hover(box.node['id'] if box else None)

    def activate(self,box):
        node=box.node;key=node['id'];kind=node['type']
        if kind=='Button':
            self.event(key,'press')
        elif kind=='Select':
            menu=self.tk.Menu(self.root,tearoff=False)
            for option in node['children']:
                menu.add_command(label=text_of(option),command=lambda value=str(option['props']['value']):self.event(key,'change',value))
            x,y,w,h=self.scene.screen_bounds(box)
            try:
                menu.tk_popup(int(self.canvas.winfo_rootx()+x),int(self.canvas.winfo_rooty()+y+h))
            finally:
                menu.grab_release()
        elif kind in ('Input','TextArea'):
            self.open_editor(box)

    def open_editor(self,box):
        self.close_editor()
        node=box.node;key=node['id'];colors=self.scene.colors
        if node['props'].get('readOnly') or node['props'].get('disabled'):
            return
        style=self.scene.node_style(node)
        options=dict(background=style.get('backgroundColor',colors['surface'])[:7],foreground=style.get('color',colors['foreground'])[:7],insertbackground=colors['accent'],relief='flat',highlightthickness=0,font=(FONT_FAMILY,int(style.get('fontSize',16)*.75*self.scene.scale)))
        self.editing=key
        if node['type']=='TextArea':
            self.editor=self.tk.Text(self.canvas,wrap='word',**options)
            self.editor.insert('1.0',node['props'].get('value',''))
            self.editor.edit_modified(False)
            def changed(_):
                if self.editor and self.editor.edit_modified():
                    self.editor.edit_modified(False)
                    self.event(key,'change',self.editor.get('1.0','end-1c'))
            self.editor.bind('<<Modified>>',changed)
        else:
            variable=self.tk.StringVar(value=str(node['props'].get('value','')))
            self.editor=self.tk.Entry(self.canvas,textvariable=variable,show='•' if node['props'].get('type')=='password' else '',**options)
            variable.trace_add('write',lambda *_:self.event(key,'change',variable.get()))
            self.editor._variable=variable
            self.editor.bind('<Return>',lambda _:self.end_edit())
        self.editor.bind('<Escape>',lambda _:self.end_edit())
        def select_all(_):
            if node['type']=='TextArea':
                self.editor.tag_add('sel','1.0','end-1c')
            else:
                self.editor.selection_range(0,'end')
            return 'break'
        self.editor.bind('<Control-a>',select_all)
        self.editor.bind('<Tab>',self.tab)
        self.editor.bind('<Button-4>',lambda _:self.scroll_by(-60))
        self.editor.bind('<Button-5>',lambda _:self.scroll_by(60))
        self.redraw()
        self.editor.focus_set()

    def end_edit(self):
        self.close_editor()
        self.canvas.focus_set()
        return 'break'

    def tab(self,event):
        self.close_editor()
        controls=[n for n in self.nodes.values() if n['type'] in ('Input','TextArea','Select','Button') and not n['props'].get('disabled') and not n['props'].get('readOnly')]
        if not controls:
            return 'break'
        ids=[n['id'] for n in controls]
        index=ids.index(self.focus_id) if self.focus_id in ids else -1
        target=controls[(index+(-1 if event.state & 1 else 1))%len(controls)]
        self.focus_id=target['id']
        box=self.scene.boxes.get(self.focus_id)
        if box and not target['props'].get('id','').startswith('nav-'):
            self.scroll=min(max(0,box.y-16),self.scene.max_scroll)
        self.redraw()
        box=next((b for b in self.scene.hits if b.node['id']==self.focus_id),None)
        if box and target['type'] in ('Input','TextArea'):
            self.open_editor(box)
        else:
            self.canvas.focus_set()
        return 'break'

    def activate_focus(self,_):
        box=next((b for b in self.scene.hits if b.node['id']==self.focus_id),None)
        if box:
            self.activate(box)
        return 'break'
