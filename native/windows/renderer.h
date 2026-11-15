/* Shared Skia layout and painting for the native snapshot protocol. */
static int props(int node){return get(snapshot,node,"props");}
static int style(int node){return get(snapshot,props(node),"style");}
static double style_num(int node,const char *name,double fallback){return number(snapshot,get(snapshot,style(node),name),fallback);}
static float horizontal_margin(int node,const char *side){
 int value=get(snapshot,style(node),side);
 return equal(snapshot,value,"auto")?0:(float)number(snapshot,value,style_num(node,"margin",0));
}
static float box_max_width(int node,float available){
 int limit=get(snapshot,style(node),"maxWidth");
 if(limit&&snapshot->t[limit].type=='"'){
  const struct Token token=snapshot->t[limit];
  if(snapshot->text[token.end-2]=='%')return (float)(atof(snapshot->text+token.start+1)*available/100);
 }
 return (float)number(snapshot,limit,available);
}
static int is(int node,const char *type){return equal(snapshot,get(snapshot,node,"type"),type);}
static void transform_text(wchar_t *text,int transform) {
    if (equal(snapshot,transform,"uppercase")) {
        CharUpperBuffW(text,(DWORD)wcslen(text));
    } else if (equal(snapshot,transform,"capitalize")) {
        bool first=true;
        for (wchar_t *letter=text;*letter;letter++) {
            WORD kind=0;
            GetStringTypeW(CT_CTYPE1,letter,1,&kind);
            if (first && (kind&C1_ALPHA)) CharUpperBuffW(letter,1);
            first=(kind&(C1_SPACE|C1_PUNCT))!=0;
        }
    }
}
static int find_identity(int node,const wchar_t *id,bool native){wchar_t test[BOX_ID_CAPACITY];if(!node||!*id)return 0;string(snapshot,get(snapshot,native?node:props(node),"id"),test,BOX_ID_CAPACITY);if(!wcscmp(test,id))return node;int a=get(snapshot,node,"children");if(a)for(int c=a+1;c<snapshot->t[a].next;c=snapshot->t[c].next){int found=find_identity(c,id,native);if(found)return found;}return 0;}
static int find_node(int node,const wchar_t *id){return find_identity(node,id,false);}
static void collect_text(int node, wchar_t *out, size_t capacity) {
    size_t length = wcslen(out);
    string(snapshot, get(snapshot, props(node), "text"), out + length, capacity - length);
    int children = get(snapshot, node, "children");
    if (children) {
        for (int child = children + 1; child < snapshot->t[children].next; child = snapshot->t[child].next) {
            collect_text(child, out, capacity);
        }
    }
}

static wchar_t *node_text(int node) {
    size_t capacity = (size_t)(snapshot->t[node].end - snapshot->t[node].start) + 1;
    wchar_t *text = calloc(capacity, sizeof(*text));
    if (!text) fail("Cannot allocate display text");
    collect_text(node, text, capacity);
    transform_text(text,get(snapshot,style(node),"textTransform"));
    return text;
}
static uint32_t color(int node,const char *key,uint32_t fallback){int t=get(snapshot,style(node),key);if(!t||snapshot->t[t].type!='"')return fallback;const char *s=snapshot->text+snapshot->t[t].start+1;if(*s!='#')return fallback;unsigned v=0;for(int n=1;n<=6;n++){char c=s[n];if(!isxdigit((unsigned char)c))return fallback;v=v*16+(c<='9'?c-'0':tolower(c)-'a'+10);}unsigned alpha=255;if(snapshot->t[t].end-snapshot->t[t].start==11){alpha=0;for(int n=7;n<=8;n++){char c=s[n];if(!isxdigit((unsigned char)c))return fallback;alpha=alpha*16+(c<='9'?c-'0':tolower(c)-'a'+10);}}return (alpha<<24)|v;}
static void *make_font_slant(const char *family,int weight,int slant){
 void *settings=sk_fontstyle_new(weight,5,slant);
 void *typeface=sk_typeface_create_from_name(family,settings);
 sk_fontstyle_delete(settings);
 void *selected=sk_font_new_with_values(typeface,16,1,0);
 if(typeface)sk_typeface_unref(typeface);
 if(!selected)fail("Cannot create native text font");
 return selected;
}
static void *make_font(const char *family,int weight){return make_font_slant(family,weight,0);}
static void *font_for(int node,void *fallback){
 if(equal(snapshot,get(snapshot,style(node),"fontFamily"),"monospace")){
  if(!mono_font)mono_font=make_font("Consolas",400);
  return mono_font;
 }
 if(equal(snapshot,get(snapshot,style(node),"fontStyle"),"italic")){
  /* SkFontStyle slant 1 selects the italic face. */
  if(style_num(node,"fontWeight",0)>=600){
   if(!bold_italic_font)bold_italic_font=make_font_slant("Segoe UI",700,1);
   return bold_italic_font;
  }
  if(!italic_font)italic_font=make_font_slant("Segoe UI",400,1);
  return italic_font;
 }
 if(style_num(node,"fontWeight",0)>=600){
  if(!bold_font)bold_font=make_font("Segoe UI",700);
  return bold_font;
 }
 if(get(snapshot,style(node),"fontWeight"))return font;
 return fallback;
}
/* Codepoints missing from the selected face (emoji, symbols, other scripts)
 * use a covering system typeface from the Skia font manager. Faces are
 * cached; codepoints no installed face covers fall back to the selected face. */
enum { FALLBACK_FONTS = 12, MISSING_CODEPOINTS = 64 };
static void *fallback_fonts[FALLBACK_FONTS];
static int fallback_count;
static uint32_t missing_codepoints[MISSING_CODEPOINTS];
static int missing_count;

static uint32_t text_codepoint(const wchar_t *text,size_t at,size_t length,size_t *units){
 uint32_t high=text[at];
 if(high>=0xd800&&high<=0xdbff&&at+1<length&&text[at+1]>=0xdc00&&text[at+1]<=0xdfff){
  *units=2;return 0x10000+((high-0xd800)<<10)+(text[at+1]-0xdc00);
 }
 *units=1;return high;
}
/* Characters that modify the preceding character stay in its run. */
static bool text_joiner(uint32_t c){
 return c==0x200d||c==0x20e3||(c>=0xfe00&&c<=0xfe0f)||(c>=0x1f3fb&&c<=0x1f3ff)||(c>=0xe0020&&c<=0xe007f);
}
static void *font_covering(void *selected,uint32_t c){
 if(c<0x80||c=='\n'||sk_font_unichar_to_glyph(selected,(int32_t)c))return selected;
 for(int i=0;i<fallback_count;i++)if(sk_font_unichar_to_glyph(fallback_fonts[i],(int32_t)c))return fallback_fonts[i];
 for(int i=0;i<missing_count;i++)if(missing_codepoints[i]==c)return selected;
 static void *manager;
 if(!manager)manager=sk_fontmgr_ref_default();
 void *typeface=NULL;
 if(manager&&fallback_count<FALLBACK_FONTS){
  void *settings=sk_fontstyle_new(400,5,0);
  typeface=sk_fontmgr_match_family_style_character(manager,NULL,settings,NULL,0,(int32_t)c);
  sk_fontstyle_delete(settings);
 }
 if(!typeface){
  if(missing_count<MISSING_CODEPOINTS)missing_codepoints[missing_count++]=c;
  return selected;
 }
 void *face=sk_font_new_with_values(typeface,16,1,0);
 sk_typeface_unref(typeface);
 if(!face)fail("Cannot create native fallback font");
 fallback_fonts[fallback_count++]=face;
 return face;
}
/* Returns the end of the run that starts at `start`, and its face. */
static size_t text_run(const wchar_t *text,size_t start,size_t length,void *selected,void **face){
 void *current=NULL;size_t at=start;
 while(at<length){
  size_t units;uint32_t c=text_codepoint(text,at,length,&units);
  void *next=current&&text_joiner(c)?current:font_covering(selected,c);
  if(!current)current=next;else if(next!=current)break;
  at+=units;
 }
 *face=current?current:selected;
 return at;
}
static float measure_units(const wchar_t *text,size_t length,float size,void *selected){
 float total=0;
 for(size_t at=0;at<length;){
  void *face;size_t end=text_run(text,at,length,selected,&face);
  sk_font_set_size(face,size);
  total+=sk_font_measure_text(face,text+at,(end-at)*2,1,NULL,NULL);
  at=end;
 }
 return total;
}
static float measure_font(const wchar_t *text,float size,void *selected){return measure_units(text,wcslen(text),size,selected);}
/* Draws with the paint's current colour; y is the baseline in canvas space. */
static void draw_text_units(const wchar_t *text,size_t length,float x,float y,float size,void *selected){
 for(size_t at=0;at<length;){
  void *face;size_t end=text_run(text,at,length,selected,&face);
  sk_font_set_size(face,size);
  sk_canvas_draw_simple_text(canvas,text+at,(end-at)*2,1,x,y,face,paint);
  x+=sk_font_measure_text(face,text+at,(end-at)*2,1,NULL,NULL);
  at=end;
 }
}
static float measure(const wchar_t *text,float size){return measure_font(text,size,font);}
static float text_lines_aligned(const wchar_t *text,float x,float y,float available,float size,uint32_t ink,int draw,float line_height,bool centered,void *selected){
 sk_font_set_size(selected,size);sk_paint_set_color(paint,ink);wchar_t line[8192];size_t n=0;float row=size*line_height,total=row;
 for(size_t p=0;;p++){wchar_t c=text[p];if(c&&c!='\n'&&n+2<8192){line[n++]=c;line[n]=0;if(measure_font(line,size,selected)<=available||n==1)continue;n--;p--;}
  line[n]=0;if(draw&&y-scroll+row>=paint_top&&y-scroll<height){
   float left=centered?x+fmaxf(0,(available-measure_font(line,size,selected))/2):x;
   draw_text_units(line,n,left,y-scroll+size,size,selected);
  }
  if(!c)break;n=0;y+=row;total+=row;
 }return total;
}
static float text_lines(const wchar_t *text,float x,float y,float available,float size,uint32_t ink,int draw,float line_height){
 return text_lines_aligned(text,x,y,available,size,ink,draw,line_height,false,font);
}
static void truncate_text(wchar_t *text,float width,float size,void *selected){
 size_t length=wcslen(text);
 for(size_t i=0;i<length;i++)if(text[i]==L'\n'||text[i]==L'\r')text[i]=L' ';
 if(!length||measure_font(text,size,selected)<=width)return;
 if(measure_font(L"\x2026",size,selected)>width){text[0]=0;return;}
 size_t low=0,high=length;
 while(high-low>1){
  size_t middle=(low+high)/2;
  wchar_t old=text[middle],next=text[middle+1];
  text[middle]=0x2026;text[middle+1]=0;
  bool fits=measure_font(text,size,selected)<=width;
  text[middle]=old;text[middle+1]=next;
  if(fits)low=middle;else high=middle;
 }
 if(low&&text[low-1]>=0xd800&&text[low-1]<=0xdbff)low--;
 text[low]=0x2026;text[low+1]=0;
}
static void rectangle(float x,float y,float w,float h,float radius,uint32_t ink){if(y+h-scroll<paint_top||y-scroll>height)return;SkRect r={x,y-scroll,x+w,y-scroll+h};sk_paint_set_color(paint,ink);sk_canvas_draw_round_rect(canvas,&r,radius,radius,paint);}
static void *box_corner_shape(int node,const SkRect *rect,float radius,float inset){
 const char *corners[]={"borderTopLeftRadius","borderTopRightRadius","borderBottomRightRadius","borderBottomLeftRadius"};
 SkVector radii[4];bool mixed=false;
 for(size_t i=0;i<4;i++){
  float corner=fmaxf(0,(float)style_num(node,corners[i],radius+inset)-inset);
  radii[i]=(SkVector){corner,corner};mixed|=corner!=radius;
 }
 if(!mixed)return NULL;
 void *shape=sk_rrect_new();
 if(!shape)fail("Cannot allocate native rounded rectangle");
 sk_rrect_set_rect_radii(shape,rect,radii);
 return shape;
}
static void draw_box_shape(int node,const SkRect *rect,float radius,float inset){
 void *shape=box_corner_shape(node,rect,radius,inset);
 if(shape){sk_canvas_draw_rrect(canvas,shape,paint);sk_rrect_delete(shape);}
 else sk_canvas_draw_round_rect(canvas,rect,radius,radius,paint);
}
static void draw_box_fill(const struct Box *box,float radius,uint32_t ink){
 if(box->y+box->h-scroll<paint_top||box->y-scroll>height)return;
 SkRect rect={box->x,box->y-scroll,box->x+box->w,box->y-scroll+box->h};
 sk_paint_set_color(paint,ink);
 draw_box_shape(box->node,&rect,radius,0);
}
static void draw_border(const struct Box *box){
 if(box->y+box->h-scroll<paint_top||box->y-scroll>height)return;
 int node=box->node;
 float stroke=fminf((float)style_num(node,"borderWidth",0),fminf(box->w,box->h));
 float top=(float)style_num(node,"borderTopWidth",0);
 float bottom=(float)style_num(node,"borderBottomWidth",0);
 float left=(float)style_num(node,"borderLeftWidth",0);
 float right=(float)style_num(node,"borderRightWidth",0);
 if(stroke<=0&&top<=0&&bottom<=0&&left<=0&&right<=0)return;
 uint32_t ink=color(node,"borderColor",box->foreground);
 if(stroke>0){
  float inset=stroke/2,y=box->y-scroll;
  SkRect border={box->x+inset,y+inset,box->x+box->w-inset,y+box->h-inset};
  float radius=fmaxf(0,(float)style_num(node,"borderRadius",0)-inset);
  sk_paint_set_color(paint,ink);
  sk_paint_set_stroke_width(paint,stroke);
  sk_paint_set_style(paint,1);
  void *dash=NULL;
  if(equal(snapshot,get(snapshot,style(node),"borderStyle"),"dashed")){
   const float pattern[]={4*stroke,3*stroke};
   dash=sk_path_effect_create_dash(pattern,2,0);
   if(!dash)fail("Cannot allocate native dashed border");
   sk_paint_set_path_effect(paint,dash);
  }
  draw_box_shape(node,&border,radius,inset);
  if(dash){
   sk_paint_set_path_effect(paint,NULL);
   sk_path_effect_unref(dash);
  }
  sk_paint_set_style(paint,0);
 }
 if(top>stroke)rectangle(box->x,box->y,box->w,top,0,ink);
 if(bottom>stroke)rectangle(box->x,box->y+box->h-bottom,box->w,bottom,0,ink);
 if(left>stroke)rectangle(box->x,box->y,left,box->h,0,ink);
 if(right>stroke)rectangle(box->x+box->w-right,box->y,right,box->h,0,ink);
}
/* Ring around the button or link focused with Tab. */
static void draw_focus_ring(const struct Box *box){
 if(box->y+box->h-scroll<paint_top||box->y-scroll>height)return;
 bool control=box->kind>=1&&box->kind<=4;
 float radius=(float)style_num(box->node,"borderRadius",control?(document_light?6:16):3)+2;
 float y=box->y-scroll;
 SkRect ring={box->x-2,y-2,box->x+box->w+2,y+box->h+2};
 sk_paint_set_color(paint,document_light?0xff1a73e8:0xff8ab4f8);
 sk_paint_set_stroke_width(paint,2);
 sk_paint_set_style(paint,1);
 sk_canvas_draw_round_rect(canvas,&ring,radius,radius,paint);
 sk_paint_set_style(paint,0);
}
/* Opaque colour with relative luminance above the middle of the range. */
static bool light_color(uint32_t ink){
 unsigned r=(ink>>16)&255,g=(ink>>8)&255,b=ink&255;
 return (ink>>24)>=128&&(2126*r+7152*g+722*b)/10000>150;
}
static bool has_border_width(int node){
 const char *widths[]={"borderWidth","borderTopWidth","borderBottomWidth","borderLeftWidth","borderRightWidth"};
 for(size_t i=0;i<sizeof(widths)/sizeof(*widths);i++)if(get(snapshot,style(node),widths[i]))return true;
 return false;
}
/* Kind 1 is a button; 2, 3 and 4 are input, select and textarea. */
static uint32_t default_control_fill(int kind,bool styled_button){
 if(kind==1)return styled_button?0:document_light?0xffefefef:0xff479cff;
 return document_light?0xffffffff:0xff1d1f23;
}
/* Controls without their own border width get a 1px default border, as in
 * a browser. `border-color` alone recolours it; `border: none` removes it. */
static void draw_default_control_border(const struct Box *box,float radius,bool disabled){
 int node=box->node;
 if(has_border_width(node)||box->y+box->h-scroll<paint_top||box->y-scroll>height)return;
 uint32_t fallback=document_light?(disabled?0xffc4c8ce:0xff8f959e):
    box->kind==1&&!disabled?0xff2f7fe0:0xff3d4048;
 uint32_t ink=color(node,"borderColor",fallback);
 float y=box->y-scroll,corner=fmaxf(0,radius-.5f);
 SkRect edge={box->x+.5f,y+.5f,box->x+box->w-.5f,y+box->h-.5f};
 sk_paint_set_color(paint,ink);
 sk_paint_set_stroke_width(paint,1);
 sk_paint_set_style(paint,1);
 sk_canvas_draw_round_rect(canvas,&edge,corner,corner,paint);
 sk_paint_set_style(paint,0);
}
#include "inline-links.h"
static void box_identity(struct Box *box) {
 if(!*box->public_id){
  box->native_id=true;
  string(snapshot,get(snapshot,box->node,"id"),box->public_id,sizeof(box->public_id)/sizeof(*box->public_id));
 }
}
static bool same_control(const struct Box *left,const struct Box *right){
 return left->kind==right->kind&&left->native_id==right->native_id&&
    *left->public_id&&!wcscmp(left->public_id,right->public_id);
}
static void move_boxes(int from,int to,float dx,float dy){
 for(int i=from;i<to;i++){
  struct Box *box=&boxes[i];
  box->x+=dx;box->y+=dy;
  if(box->clipped){
   box->clip.left+=dx;box->clip.right+=dx;
   box->clip.top+=dy;box->clip.bottom+=dy;
  }
 }
}
static float layout_child(int node,float x,float y,float w,float containing_width,int depth,uint32_t foreground,bool centered_text,float assigned_height,float inherited_size);
struct ViewportNode {int node;uint32_t foreground;bool centered;float text_size,z;};
static struct ViewportNode viewport_nodes[128];
static int viewport_count;
static bool viewport_height_in_flow;
static bool laying_out_caption;

static bool caption_position(int node,const char *value){
 return laying_out_caption&&node!=titlebar_node&&equal(snapshot,get(snapshot,style(node),"position"),value);
}

static int window_titlebar(int tree){
 int children=get(snapshot,tree,"children"),titlebar=0;
 if(children)for(int node=children+1;node<snapshot->t[children].next;node=snapshot->t[node].next){
  if(!equal(snapshot,get(snapshot,props(node),"data-native-window-titlebar"),"true"))continue;
  if(titlebar)fail("A window supports one WindowTitleBar");
  titlebar=node;
 }
 return titlebar;
}

static bool fixed_position(int node){
 return node==titlebar_node||equal(snapshot,get(snapshot,style(node),"position"),"fixed");
}
static bool outside_layout_flow(int node){
 return fixed_position(node)||caption_position(node,"absolute");
}
static float caption_offset(int node,const char *start,const char *end){
 if(!caption_position(node,"relative"))return 0;
 return (float)style_num(node,start,-style_num(node,end,0));
}
static bool bottom_sheet(int node){
 return is(node,"Modal")&&equal(snapshot,get(snapshot,props(node),"data-native-sheet"),"true");
}

static void defer_viewport_node(int node,uint32_t foreground,bool centered,float size){
 if(node==titlebar_node)return;
 for(int i=0;i<viewport_count;i++)if(viewport_nodes[i].node==node)return;
 if(viewport_count==(int)(sizeof(viewport_nodes)/sizeof(*viewport_nodes)))fail("Too many fixed native elements");
 viewport_nodes[viewport_count++]=(struct ViewportNode){node,foreground,centered,size,(float)style_num(node,"zIndex",0)};
}

static float layout(int node,float x,float y,float w,int depth,uint32_t foreground){
 viewport_count=0;
 viewport_height_in_flow=false;
 if(fixed_position(node)){
  defer_viewport_node(node,foreground,false,0);
  return 0;
 }
 return layout_child(node,x,y,w,w,depth,foreground,false,-1,0);
}

static void layout_viewport(void){
 for(int processed=0;processed<viewport_count;processed++){
  int next=processed;
  for(int i=processed+1;i<viewport_count;i++){
   bool current_modal=is(viewport_nodes[i].node,"Modal"),next_modal=is(viewport_nodes[next].node,"Modal");
   if(current_modal!=next_modal){if(!current_modal)next=i;}
   else if(viewport_nodes[i].z<viewport_nodes[next].z||
       (viewport_nodes[i].z==viewport_nodes[next].z&&viewport_nodes[i].node<viewport_nodes[next].node))next=i;
  }
  struct ViewportNode item=viewport_nodes[next];
  viewport_nodes[next]=viewport_nodes[processed];
  viewport_nodes[processed]=item;
  int node=item.node,start=box_count;
  bool modal=is(node,"Modal");
  bool sheet=bottom_sheet(node);
  float left=(float)style_num(node,"left",0),right=(float)style_num(node,"right",0);
  float available=fmaxf(10,width-left-right);
  if(modal){
   available=sheet?fminf(width,576*document_scale):fmaxf(10,fminf(width-32*document_scale,672*document_scale));
   left=(width-available)/2;
  }
  layout_child(node,left,0,available,available,0,item.foreground,item.centered,-1,item.text_size);
  if(modal){
   float limit=sheet?fmaxf(1,height-chrome_height-16*document_scale):
    fmaxf(1,fminf(height-chrome_height-32*document_scale,768*document_scale));
   if(boxes[start].h>limit){
    box_count=start;
    layout_child(node,left,0,available,available,0,item.foreground,item.centered,limit,item.text_size);
   }
  }
  int top=get(snapshot,style(node),"top"),bottom=get(snapshot,style(node),"bottom");
  bool css_viewport=equal(snapshot,get(snapshot,props(node),"nativeCssViewport"),"true");
  float target=sheet?height-boxes[start].h:modal?fmaxf(chrome_height,(height+chrome_height-boxes[start].h)/2):
   (float)number(snapshot,top,bottom?height-boxes[start].h-number(snapshot,bottom,0):chrome_height)
      +(css_viewport&&top?chrome_height:0);
  float shift=css_viewport&&get(snapshot,style(node),"right")&&!get(snapshot,style(node),"left")
      ? width-right-boxes[start].w-boxes[start].x : 0;
  move_boxes(start,box_count,shift,target+scroll);
  boxes[start].viewport_root=true;
  boxes[start].modal_root=modal;
  for(int i=start;i<box_count;i++){
   boxes[i].viewport=true;
   boxes[i].viewport_scroll=scroll;
  }
 }
}

static int active_modal_node(void){
 int tree=get(snapshot,1,"tree"),children=get(snapshot,tree,"children"),active=0;
 if(children)for(int node=children+1;node<snapshot->t[children].next;node=snapshot->t[node].next){
  if(is(node,"Modal"))active=node;
 }
 return active;
}

static int modal_box_index(void){
 for(int i=box_count-1;i>=0;i--)if(boxes[i].modal_root)return i;
 return -1;
}

static bool active_sheet_motion(void){
 int node=active_modal_node();
 if(!bottom_sheet(node)||!*sheet_id)return false;
 wchar_t id[BOX_ID_CAPACITY];
 string(snapshot,get(snapshot,node,"id"),id,sizeof(id)/sizeof(*id));
 return !wcscmp(id,sheet_id);
}

static void place_sheet_motion(void){
 int index=modal_box_index();
 int node=index>=0?boxes[index].node:0;
 wchar_t id[BOX_ID_CAPACITY]={0};
 if(bottom_sheet(node))string(snapshot,get(snapshot,node,"id"),id,sizeof(id)/sizeof(*id));
 if(wcscmp(id,sheet_id)){
  bool captured=sheet_motion.dragging;
  sheet_motion=(struct SheetMotion){0};
  wcscpy(sheet_id,id);
  if(captured&&GetCapture()==window)ReleaseCapture();
  if(*sheet_id&&!document_reduce_motion){
   sheet_motion.offset=boxes[index].h;
   sheet_animate(&sheet_motion,0,0,.8f,GetTickCount64());
  }
 }
 if(!*sheet_id)return;
 sheet_motion.height=boxes[index].h;
 if(sheet_motion.closing)sheet_motion.target=sheet_motion.height;
 move_boxes(index,boxes[index].end,0,sheet_motion.offset);
 animating_svg|=sheet_motion.animating;
}

static int viewport_hit_floor(float x,float y){
 for(int i=box_count-1;i>=0;i--)if(boxes[i].modal_root||
    (boxes[i].viewport_root&&in_box(&boxes[i],x,y)))return i;
 return 0;
}
struct LayoutChild {int node;float basis,grow;};
static void add_divider(float x,float y,float w,float thickness,uint32_t ink){
 if(box_count>=4096)fail("Too many native dividers");
 boxes[box_count++]=(struct Box){.x=x,.y=y,.w=w,.h=thickness,.kind=11,.foreground=ink};
}

static void clip_descendants(int from,int to,SkRect clip){
 for(int i=from;i<to;i++){
  struct Box *box=&boxes[i];
  if(box->clipped){
   box->clip.left=fmaxf(box->clip.left,clip.left);
   box->clip.top=fmaxf(box->clip.top,clip.top);
   box->clip.right=fminf(box->clip.right,clip.right);
   box->clip.bottom=fminf(box->clip.bottom,clip.bottom);
  }else{
   box->clip=clip;box->clipped=true;
  }
 }
}

struct ScrollPosition {wchar_t id[BOX_ID_CAPACITY];bool native_id;float offset;};
static struct ScrollPosition previous_scroll[4096];

static int remember_nested_scroll(void){
 int count=0;
 if(!reset_nested_scroll)for(int i=0;i<box_count;i++){
  const struct Box *box=&boxes[i];
  if(!box->scroll_region||!box->scroll_offset)continue;
  struct ScrollPosition *position=&previous_scroll[count++];
  wcscpy(position->id,box->public_id);
  position->native_id=box->native_id;
  position->offset=box->scroll_offset;
 }
 reset_nested_scroll=false;
 return count;
}

static void place_overflow(int previous_count){
 for(struct ScrollRequest *request=first_scroll_request;request;request=request->next){
  for(int i=0;i<box_count;i++){
   int id=get(snapshot,boxes[i].node,"id");
   if(!id)continue;
   const struct Token token=snapshot->t[id];
   if((size_t)(token.end-token.start)==request->length&&
      !memcmp(snapshot->text+token.start,request->id,request->length)){request->box=i;break;}
  }
 }
 // Move the inner regions first so outer clipping stays in its own coordinates.
 for(int i=box_count-1;i>=0;i--){
  struct Box *box=&boxes[i];
  if(box->scroll_region){
   for(int p=0;p<previous_count;p++){
    const struct ScrollPosition *position=&previous_scroll[p];
    if(position->native_id!=box->native_id||wcscmp(position->id,box->public_id))continue;
    box->scroll_offset=fminf(position->offset,box->scroll_max);
    break;
   }
   for(const struct ScrollRequest *request=first_scroll_request;request;request=request->next){
    if(request->box<=i||request->box>=box->end)continue;
    float top=boxes[request->box].y-box->y;
    box->scroll_offset=fmaxf(0,fminf(top,box->scroll_max));
   }
   move_boxes(i+1,box->end,0,-box->scroll_offset);
  }
  if(box->scroll_region||equal(snapshot,get(snapshot,style(box->node),"clipOverflow"),"true")){
   clip_descendants(i+1,box->end,(SkRect){box->x,box->y,box->x+box->w,box->y+box->h});
  }
 }
 clear_scroll_requests();
}

static bool scroll_nested(float x,float y,float delta){
 int floor=viewport_hit_floor(x,y);
 for(int i=box_count-1;i>=floor;i--){
  struct Box *box=&boxes[i];
  if(!box->scroll_region||!in_box(box,x,y))continue;
  float offset=fmaxf(0,fminf(box->scroll_offset+delta,box->scroll_max));
  if(offset==box->scroll_offset){
   if(equal(snapshot,get(snapshot,style(box->node),"overscrollContain"),"true"))return true;
   continue;
  }
  box->scroll_offset=offset;
  return true;
 }
 return false;
}

static bool scroll_region_key(WPARAM key,bool reverse){
 int modal=modal_box_index(),floor=modal>=0?(bottom_sheet(boxes[modal].node)?modal:modal+1):0;
 int end=modal>=0?boxes[modal].end:box_count;
 int current=-1;
 for(int i=floor;i<end;i++){
  if(boxes[i].scroll_region&&same_control(&boxes[i],&scroll_focus)){current=i;break;}
 }
 if(key==VK_TAB){
  int direction=reverse?-1:1;
  int start=current>=0?current+direction:reverse?end-1:floor;
  for(int i=start;i>=floor&&i<end;i+=direction){
   if(boxes[i].scroll_region&&equal(snapshot,get(snapshot,boxes[i].props,"tabIndex"),"0")){
    scroll_focus=boxes[i];return true;
   }
  }
  scroll_focus=(struct Box){0};
  return current>=0;
 }
 if(current<0)return false;
 struct Box *box=&boxes[current];
 float offset=box->scroll_offset;
 switch(key){
 case VK_UP:offset-=30;break;
 case VK_DOWN:offset+=30;break;
 case VK_PRIOR:offset-=box->h;break;
 case VK_NEXT:offset+=box->h;break;
 case VK_SPACE:offset+=reverse?-box->h:box->h;break;
 case VK_HOME:offset=0;break;
 case VK_END:offset=box->scroll_max;break;
 default:return false;
 }
 box->scroll_offset=fmaxf(0,fminf(offset,box->scroll_max));
 return true;
}

static float text_size(int node,float inherited_size){
 float fallback=(is(node,"Heading")?22:is(node,"Label")?13:14)*document_scale;
 return (float)style_num(node,"fontSize",inherited_size>0?inherited_size:fallback);
}

static struct Box text_region(const struct Box *box){
 struct Box area=*box;
 int node=box->node;
 float padding=(float)style_num(node,"padding",0);
 float left=(float)style_num(node,"paddingLeft",padding);
 float right=(float)style_num(node,"paddingRight",padding);
 area.x+=left;
 area.y+=(float)style_num(node,"paddingTop",padding)+box->text_offset;
 area.w=fmaxf(1,area.w-left-right);
 return area;
}

static float wrap_item_width(int node,float available,float inherited_size){
 int rules=style(node);
 float margin=horizontal_margin(node,"marginLeft")+horizontal_margin(node,"marginRight");
 int width_rule=get(snapshot,rules,"width");
 float desired=(float)number(snapshot,width_rule,0);
 if(equal(snapshot,width_rule,"100%"))desired=available-margin;
 if(!width_rule){
  float padding=(float)style_num(node,"padding",0);
  float inner=fmaxf(0,available-margin-style_num(node,"paddingLeft",padding)-style_num(node,"paddingRight",padding));
  float size=text_size(node,inherited_size);
  if(is(node,"Container")||is(node,"LinkBlock")){
   int children=get(snapshot,node,"children");
   bool row=equal(snapshot,get(snapshot,rules,"display"),"flex")&&
       !equal(snapshot,get(snapshot,rules,"flexDirection"),"column");
   float gap=(float)style_num(node,"columnGap",style_num(node,"gap",0));
   bool first=true;
   if(children)for(int child=children+1;child<snapshot->t[children].next;child=snapshot->t[child].next){
    if(outside_layout_flow(child))continue;
    float width=wrap_item_width(child,inner,size);
    desired=row?desired+(first?0:gap)+width:fmaxf(desired,width);
    first=false;
   }
  }else if(is(node,"Svg")){
   desired=(float)number(snapshot,get(snapshot,props(node),"width"),24);
  }else if(is(node,"Input")||is(node,"TextArea")||is(node,"Select")){
   desired=160*document_scale;
  }else{
   wchar_t *text=node_text(node);
   desired=measure_font(text,size,font_for(node,font));
   free(text);
   if(is(node,"Button")&&!get(snapshot,rules,"paddingLeft")&&!get(snapshot,rules,"paddingRight"))
    desired+=24*document_scale;
  }
  desired+=(float)(style_num(node,"paddingLeft",padding)+style_num(node,"paddingRight",padding));
 }
 desired=fminf(desired,box_max_width(node,available));
 desired=fmaxf(desired,(float)style_num(node,"minWidth",0));
 return fmaxf(10,fminf(available,desired+margin));
}

static void layout_caption_overlay(int node,const struct Box *parent,float padding_left,
    float padding_top,int depth,float inherited_size){
 float left=(float)style_num(node,"left",NAN),right=(float)style_num(node,"right",NAN);
 float top=(float)style_num(node,"top",NAN),bottom=(float)style_num(node,"bottom",NAN);
 float explicit_width=(float)style_num(node,"width",NAN);
 float margin=horizontal_margin(node,"marginLeft")+horizontal_margin(node,"marginRight");
 float start_x=isfinite(left)?left:isfinite(right)?0:padding_left;
 float start_y=isfinite(top)?top:isfinite(bottom)?0:padding_top;
 float available=fmaxf(10,parent->w-start_x-(isfinite(right)?right:0));
 float w=isfinite(explicit_width)?explicit_width+margin:
    isfinite(left)&&isfinite(right)?available:wrap_item_width(node,available,inherited_size);
 float h=isfinite(top)&&isfinite(bottom)?
    fmaxf(0,parent->h-top-bottom-style_num(node,"marginTop",0)-style_num(node,"marginBottom",0)):-1;
 int start=box_count;
 layout_child(node,parent->x+start_x,parent->y+start_y,w,parent->w,depth+1,
    parent->foreground,parent->centered_text,h,inherited_size);
 const struct Box *box=&boxes[start];
 float dx=!isfinite(left)&&isfinite(right)?
    parent->x+parent->w-right-box->w-horizontal_margin(node,"marginRight")-box->x:0;
 float dy=!isfinite(top)&&isfinite(bottom)?
    parent->y+parent->h-bottom-box->h-(float)style_num(node,"marginBottom",0)-box->y:0;
 if(dx||dy)move_boxes(start,box_count,dx,dy);
}

struct FlexItem {int node,start,end;float width,height,baseline,grow,min_width;bool auto_left,auto_right;};

static float layout_flex_row(int node,int depth,float x,float y,float w,float inherited_size,
    int children,int count,const struct Box *parent,bool wrap,float minimum){
 if(!count)return 0;
 struct FlexItem *items=calloc(count,sizeof(*items));
 if(!items)fail("Cannot allocate native flex row");
 int index=0,rules=style(node);
 float gap=(float)style_num(node,"gap",0);
 float column_gap=(float)style_num(node,"columnGap",gap),row_gap=(float)style_num(node,"rowGap",gap);
 int justify=get(snapshot,rules,"justifyContent"),align=get(snapshot,rules,"alignItems");
 bool baseline=equal(snapshot,align,"baseline");
 for(int child=children+1;child<snapshot->t[children].next;child=snapshot->t[child].next){
  if(outside_layout_flow(child))continue;
  float basis=fmaxf(10,(float)style_num(child,"flexBasis",wrap_item_width(child,w,inherited_size)));
  float min_width=fminf(basis,fmaxf(10,(float)style_num(child,"minWidth",0)));
  if(style_num(child,"flexShrink",1)==0)min_width=basis;
  items[index++]=(struct FlexItem){.node=child,.width=basis,.min_width=min_width,
    .grow=(float)style_num(child,"flexGrow",0),
    .auto_left=equal(snapshot,get(snapshot,style(child),"marginLeft"),"auto"),
    .auto_right=equal(snapshot,get(snapshot,style(child),"marginRight"),"auto")};
 }
 float top=y;
 for(int first=0;first<count;){
  int end=first+1;
  float used=items[first].width;
  while(end<count&&(!wrap||used+column_gap+items[end].width<=w+.01f)){
   used+=column_gap+items[end++].width;
  }
  float grow=0,shrink=0;int auto_margins=0;
  for(int i=first;i<end;i++){
   grow+=items[i].grow;
   shrink+=items[i].width-items[i].min_width;
   auto_margins+=items[i].auto_left+items[i].auto_right;
  }
  float free_width=fmaxf(0,w-used);
  if(free_width>0&&grow>0){
   for(int i=first;i<end;i++)items[i].width+=free_width*items[i].grow/grow;
   free_width=0;
  }else if(used>w&&shrink>0){
   float fraction=fminf(1,(used-w)/shrink);
   for(int i=first;i<end;i++)items[i].width-=(items[i].width-items[i].min_width)*fraction;
  }
  float auto_margin=auto_margins?free_width/auto_margins:0;
  if(auto_margins)free_width=0;
  float left=x,spacing=column_gap,row_height=0,max_baseline=0;
  if(equal(snapshot,justify,"center"))left+=free_width/2;
  if(equal(snapshot,justify,"end"))left+=free_width;
  if(equal(snapshot,justify,"space-between")&&end-first>1)spacing+=free_width/(end-first-1);
  if(equal(snapshot,justify,"space-around")){
   spacing+=free_width/(end-first);
   left+=free_width/(2*(end-first));
  }
  for(int i=first;i<end;i++){
   struct FlexItem *item=&items[i];
   if(item->auto_left)left+=auto_margin;
   item->start=box_count;
   item->height=layout_child(item->node,left,top,item->width,w,depth+1,parent->foreground,parent->centered_text,-1,inherited_size);
   item->end=box_count;
   item->baseline=item->height;
   for(int b=item->start;baseline&&b<item->end;b++){
    const struct Box *box=&boxes[b];
    if(box->kind==6||box->kind==8){
     struct Box area=text_region(box);
     item->baseline=area.y-top+area.size-caption_offset(item->node,"top","bottom");
     break;
    }
   }
   max_baseline=fmaxf(max_baseline,item->baseline);
   left+=item->width+spacing+(item->auto_right?auto_margin:0);
   row_height=fmaxf(row_height,item->height);
  }
  if(first==0&&end==count)row_height=fmaxf(row_height,minimum);
  float aligned_height=row_height;
  for(int i=first;i<end;i++){
   struct FlexItem *item=&items[i];
   float offset=0;
   if(equal(snapshot,align,"center"))offset=(row_height-item->height)/2;
   if(equal(snapshot,align,"end"))offset=row_height-item->height;
   if(baseline)offset=max_baseline-item->baseline;
   if(equal(snapshot,align,"stretch")&&!get(snapshot,style(item->node),"height")){
    float vertical_margin=(float)(style_num(item->node,"marginTop",0)+style_num(item->node,"marginBottom",0));
    boxes[item->start].h=fmaxf(boxes[item->start].h,row_height-vertical_margin);
   }
   if(offset)move_boxes(item->start,item->end,0,offset);
   aligned_height=fmaxf(aligned_height,item->height+offset);
  }
  top+=aligned_height+(end<count?row_gap:0);
  first=end;
 }
 free(items);
 return top-y;
}

static float layout_child(int node,float x,float y,float w,float containing_width,int depth,uint32_t foreground,bool centered_text,float assigned_height,float inherited_size){
 if(depth>80||box_count>=4095)fail("UI exceeds layout limits");int index=box_count++;struct Box *b=&boxes[index];*b=(struct Box){node,props(node),x,y,w,0,14,0};
 string(snapshot,get(snapshot,props(node),"id"),b->public_id,BOX_ID_CAPACITY);
 b->foreground=color(node,"color",foreground);
 int align=get(snapshot,style(node),"textAlign");
 b->centered_text=align?equal(snapshot,align,"center"):centered_text;
 float ml=horizontal_margin(node,"marginLeft"),mr=horizontal_margin(node,"marginRight");x+=ml;y+=style_num(node,"marginTop",0);w-=ml+mr;
 float max_width = get(snapshot,style(node),"maxWidth") ? box_max_width(node,containing_width) : w;
 if (max_width < w) {
    if (equal(snapshot, get(snapshot, style(node), "alignSelf"), "center")) x += (w - max_width) / 2;
    w = max_width;
 }
 w=fmaxf(10,fminf(w,(float)style_num(node,"width",w)));
 float gap=style_num(node,"gap",10),padding=style_num(node,"padding",0);wchar_t ui[80];string(snapshot,get(snapshot,props(node),"data-ui"),ui,80);
 if(is(node,"Container")||is(node,"LinkBlock")||is(node,"Modal")){
  if(is(node,"LinkBlock")){b->kind=10;box_identity(b);}
  else if(get(snapshot,b->props,"press")){b->kind=12;box_identity(b);}
  if(!wcscmp(ui,L"card")&&!padding)padding=18;
  float pl=style_num(node,"paddingLeft",padding),pr=style_num(node,"paddingRight",padding),pt=style_num(node,"paddingTop",padding),pb=style_num(node,"paddingBottom",padding);
  bool bullets=equal(snapshot,get(snapshot,style(node),"listDisc"),"true");
  if(bullets)pl=fmaxf(pl,12*document_scale);
  float child_size=(float)style_num(node,"fontSize",inherited_size);
  int a=get(snapshot,node,"children"),count=0;
  if(a)for(int c=a+1;c<snapshot->t[a].next;c=snapshot->t[c].next){
   if(fixed_position(c))defer_viewport_node(c,b->foreground,b->centered_text,child_size);
   else if(!caption_position(c,"absolute"))count++;
  }
  int columns=(int)style_num(node,"gridColumns",0);
  int direction=get(snapshot,style(node),"flexDirection");
  bool row=!columns&&(equal(snapshot,direction,"row")||
      (equal(snapshot,get(snapshot,style(node),"display"),"flex")&&!equal(snapshot,direction,"column")));
  bool wrap=equal(snapshot,get(snapshot,style(node),"flexWrap"),"true");
  float available_height=(float)style_num(node,"height",assigned_height);
  if(get(snapshot,style(node),"viewportBottom")){
   available_height=fmaxf(0,height-y-(float)style_num(node,"viewportBottom",0));
   viewport_height_in_flow=true;
  }
  bool definite=available_height>=0;
  float minimum=fmaxf(available_height,(float)style_num(node,"minHeight",0));
  if(equal(snapshot,get(snapshot,style(node),"minHeight"),"100dvh"))minimum=fmaxf(minimum,height-chrome_height-20);
  if(row){
   float inner=fmaxf(10,w-pl-pr);
   float natural=pt+layout_flex_row(node,depth,x+pl,y+pt,inner,child_size,a,count,b,wrap,minimum-pt-pb)+pb;
   b->h=fmaxf(natural,minimum);
  }else{
  if(columns>8)columns=1;if(columns<1)columns=1;
  float horizontal_gap=(float)style_num(node,"columnGap",gap);
  if(definite&&!get(snapshot,style(node),"gap"))gap=0;
  gap=(float)style_num(node,"rowGap",gap);
  float cw=(w-pl-pr-horizontal_gap*(columns-1))/columns,top=y+pt,row_height=0;int col=0;
  float divider=columns==1?(float)style_num(node,"divideWidth",0):0;
  uint32_t divider_ink=color(node,"divideColor",b->foreground);
  bool center_children=equal(snapshot,get(snapshot,style(node),"alignItems"),"center");
  bool measure_flex=columns==1&&(minimum>0||definite)&&count;
  struct LayoutChild *children=measure_flex?calloc(count,sizeof(*children)):NULL;
  if(measure_flex&&!children)fail("Cannot allocate native flex layout");
  float grow=0,basis_delta=0;int child_index=0,placed=0;
  if(a)for(int c=a+1;c<snapshot->t[a].next;c=snapshot->t[c].next){
   if(outside_layout_flow(c))continue;
   if(divider>0&&placed){add_divider(x+pl,top-gap/2,cw,divider,divider_ink);top+=divider;}
   placed++;
   int start=box_count;
   float left=x+pl+col*(cw+horizontal_gap);
   float child_width=center_children&&is(c,"Text")?wrap_item_width(c,cw,child_size):cw;
   float h=layout_child(c,left,top,child_width,cw,depth+1,b->foreground,b->centered_text,-1,child_size);
   boxes[start].list_bullet=bullets&&equal(snapshot,get(snapshot,props(c),"role"),"listitem");
   if(center_children)move_boxes(start,box_count,
      left+(cw-boxes[start].w)/2-boxes[start].x+caption_offset(c,"left","right"),0);
   if(children){
    float weight=(float)style_num(c,"flexGrow",0);
    float basis=definite&&weight>0?(float)style_num(c,"flexBasis",h):h;
    children[child_index++]=(struct LayoutChild){c,basis,weight};grow+=weight;
    basis_delta+=basis-h;
   }
   if(h>row_height)row_height=h;
   if(++col==columns){top+=row_height+gap;row_height=0;col=0;}
  }
  if(col)top+=row_height+gap;
  float natural=(count?top-y-gap:pt)+pb;
  float extra=fmaxf(0,minimum-natural);
  if(grow>0&&(definite||extra>0)){
   float flex_space=fmaxf(0,minimum-natural-basis_delta);
   box_count=index+1;top=y+pt;
   for(int i=0;i<count;i++){
    if(divider>0&&i){add_divider(x+pl,top-gap/2,cw,divider,divider_ink);top+=divider;}
    int start=box_count;
    const struct LayoutChild *child=&children[i];
    float allocated=child->grow>0?child->basis+flex_space*child->grow/grow:-1;
    float child_width=center_children&&is(child->node,"Text")?wrap_item_width(child->node,cw,child_size):cw;
    top+=layout_child(child->node,x+pl,top,child_width,cw,depth+1,b->foreground,b->centered_text,allocated,child_size)+gap;
    boxes[start].list_bullet=bullets&&equal(snapshot,get(snapshot,props(child->node),"role"),"listitem");
    if(center_children)move_boxes(start,box_count,
       x+pl+(cw-boxes[start].w)/2-boxes[start].x+caption_offset(child->node,"left","right"),0);
   }
   natural=top-y-gap+pb;
   extra=fmaxf(0,minimum-natural);
  }
  if(extra>0&&equal(snapshot,get(snapshot,style(node),"justifyContent"),"center"))
   move_boxes(index+1,box_count,0,extra/2);
  if(equal(snapshot,get(snapshot,style(node),"scrollY"),"true")){
   b->scroll_region=true;
   box_identity(b);
   b->h=definite?minimum:natural+extra;
   b->h=fminf(b->h,(float)style_num(node,"maxHeight",b->h));
   b->scroll_max=fmaxf(0,natural-b->h);
  }else b->h=natural+extra;
  free(children);
  }
  b->x=x;b->y=y;b->w=w;
  // Resolve insets against the measured container, after its normal children.
  if(laying_out_caption&&a)for(int c=a+1;c<snapshot->t[a].next;c=snapshot->t[c].next){
   if(caption_position(c,"absolute"))layout_caption_overlay(c,b,pl,pt,depth,child_size);
  }
 }else if(is(node,"Button")||is(node,"Input")||is(node,"Select")||is(node,"TextArea")){
  b->kind=is(node,"Button")?1:is(node,"Select")?3:is(node,"TextArea")?4:2;
  bool styled_button=b->kind==1&&(get(snapshot,b->props,"nativeVariants")||get(snapshot,b->props,"data-native-window-command"));
  b->size=styled_button?text_size(node,inherited_size):style_num(node,"fontSize",(w<85?11:16)*document_scale);
  float normal_height=(b->kind==4?110:48)*document_scale;
  if(b->kind==4&&get(snapshot,b->props,"rows")){
   normal_height=(float)number(snapshot,get(snapshot,b->props,"rows"),1)*b->size*1.4f+
    style_num(node,"paddingTop",padding)+style_num(node,"paddingBottom",padding)+2*style_num(node,"borderWidth",0);
  }
  if(styled_button&&(get(snapshot,style(node),"paddingTop")||get(snapshot,style(node),"paddingBottom")))
   normal_height=b->size*1.4f+style_num(node,"paddingTop",padding)+style_num(node,"paddingBottom",padding);
  b->h=style_num(node,"height",caption_position(node,"absolute")&&assigned_height>=0?assigned_height:normal_height);
  b->h=fmaxf((float)style_num(node,"minHeight",0),fminf(b->h,(float)style_num(node,"maxHeight",b->h)));
  box_identity(b);
 }else if(is(node,"Chart")){b->kind=5;b->h=160;}
 else if(is(node,"Svg")){
    b->kind=7;
    w=fminf(w,(float)style_num(node,"width",number(snapshot,get(snapshot,b->props,"width"),24)));
    b->h=(float)style_num(node,"height",number(snapshot,get(snapshot,b->props,"height"),24));
 }else if(is(node,"SvgPath")||is(node,"SvgRect")||is(node,"SvgCircle")){
    fail("SVG primitives need an SVG viewport");
 }
 else {
    float padding=(float)style_num(node,"padding",0);
    float top=(float)style_num(node,"paddingTop",padding),bottom=(float)style_num(node,"paddingBottom",padding);
    b->x=x;b->y=y;b->w=w;
    b->size = text_size(node,inherited_size);
    if(equal(snapshot,get(snapshot,style(node),"justifyContent"),"center"))b->centered_text=true;
    struct Box area=text_region(b);
    if (needs_inline_layout(node)) {
        b->kind = 8;
        b->h = inline_layout(&area, false);
    } else {
        wchar_t *text = node_text(node);
        float line_height=(float)style_num(node,"lineHeight",1.4);
        b->h = equal(snapshot,get(snapshot,style(node),"truncate"),"true") ? b->size*line_height :
            text_lines_aligned(text, area.x, area.y, area.w, b->size, 0, 0, line_height, false, font_for(node,font));
        b->kind = 6;
        free(text);
    }
    b->h+=top+bottom;
    float extra=fmaxf(0,(float)style_num(node,"height",0)-b->h);
    if(extra&&equal(snapshot,get(snapshot,style(node),"alignItems"),"center")){
     b->text_offset=extra/2;
     move_boxes(index+1,box_count,0,b->text_offset);
    }
    b->h+=extra;
 }
 b->x=x;b->y=y;b->w=w;b->end=box_count;
 float dx=caption_offset(node,"left","right"),dy=caption_offset(node,"top","bottom");
 if(dx||dy)move_boxes(index,box_count,dx,dy);
 return b->h+style_num(node,"marginBottom",0);
}
static void chart(struct Box *b){int a=get(snapshot,b->props,"values"),count=0;double max=1;if(a)for(int c=a+1;c<snapshot->t[a].next;c=snapshot->t[c].next){double v=number(snapshot,c,0);if(v>max)max=v;count++;}
 rectangle(b->x,b->y,b->w,b->h,12,0xff1d1f23);if(!count){text_lines(L"No recorded data",b->x+12,b->y+20,b->w-24,14,0xffadb0b6,1,1.4);return;}
 float oldx=0,oldy=0;int n=0;sk_paint_set_color(paint,0xff479cff);sk_paint_set_stroke_width(paint,3);
 for(int c=a+1;c<snapshot->t[a].next;c=snapshot->t[c].next){float xx=b->x+16+(count==1?.5f:(float)n/(count-1))*(b->w-32),yy=b->y+b->h-20-(float)(number(snapshot,c,0)/max)*(b->h-40)-scroll;if(n)sk_canvas_draw_line(canvas,oldx,oldy,xx,yy,paint);else{SkRect dot={xx-3,yy-3,xx+3,yy+3};sk_canvas_draw_round_rect(canvas,&dot,3,3,paint);}oldx=xx;oldy=yy;n++;}
}
static void draw_icon(int node,float x,float y,float w,float h,uint32_t foreground) {
 if(y+h<paint_top||y>height)return;
 bool spin=equal(snapshot,get(snapshot,style(node),"spin"),"true");
 animating_svg|=spin;
 float rotation=spin?(float)(GetTickCount64()%1000)*.36f:0;
 draw_svg(snapshot,node,canvas,paint,x,y,w,h,foreground,rotation);
}

struct EnterAnimation {uint64_t key;ULONGLONG start;};
static struct EnterAnimation enter_before[4096],enter_now[4096];
static int enter_before_count;

static ULONGLONG enter_start(int node,ULONGLONG now,int *count){
 int id=get(snapshot,node,"id");
 if(!id)return now;
 uint64_t key=14695981039346656037ULL;
 for(int i=snapshot->t[id].start;i<snapshot->t[id].end;i++){
  key^=(unsigned char)snapshot->text[i];
  key*=1099511628211ULL;
 }
 ULONGLONG start=now;
 for(int i=0;i<enter_before_count;i++)if(enter_before[i].key==key){start=enter_before[i].start;break;}
 enter_now[(*count)++]=(struct EnterAnimation){key,start};
 return start;
}

static float enter_ease(float time){
 float low=0,high=1;
 for(int i=0;i<12;i++){
  float t=(low+high)/2,u=1-t;
  float x=.66f*u*u*t+1.08f*u*t*t+t*t*t;
  if(x<time)low=t;else high=t;
 }
 float u=1-(low+high)/2;
 return 1-u*u*u;
}

static float active_scale(const struct Box *box){
 int variants=get(snapshot,box->props,"nativeVariants");
 return (float)number(snapshot,get(snapshot,get(snapshot,variants,"active"),"scale"),1);
}

static float active_opacity(const struct Box *box){
 int variants=get(snapshot,box->props,"nativeVariants");
 return (float)number(snapshot,get(snapshot,get(snapshot,variants,"active"),"opacity"),1);
}

static void blur_backdrop(SkRect bounds,float blur){
 if(blur<=0||bounds.top>=height||bounds.bottom<=paint_top)return;
 void *filter=sk_imagefilter_new_blur(blur,blur,0,NULL,NULL);
 if(!filter)fail("Cannot allocate native backdrop blur");
 SkLayerRec layer={.bounds=&bounds,.backdrop=filter};
 sk_canvas_save(canvas);
 sk_canvas_clip_rect_with_operation(canvas,&bounds,1,false);
 sk_canvas_save_layer_rec(canvas,&layer);
 sk_canvas_restore(canvas);
 sk_canvas_restore(canvas);
 sk_imagefilter_unref(filter);
}

static void draw_backdrop(const struct Box *box){
 float y=box->y-scroll;
 blur_backdrop((SkRect){box->x,y,box->x+box->w,y+box->h},(float)style_num(box->node,"backdropBlur",0));
}

struct DrawScope {int end,scroll_box;};

static void finish_draw_scope(struct DrawScope scope){
 if(scope.scroll_box){
  const struct Box *b=&boxes[scope.scroll_box-1];
  if(b->scroll_max>0&&b->h>12&&!equal(snapshot,get(snapshot,style(b->node),"hideScrollbar"),"true")){
   float track=b->h-4;
   float thumb=fminf(track,fmaxf(12,track*b->h/(b->h+b->scroll_max)));
   float y=b->y+2+(track-thumb)*b->scroll_offset/b->scroll_max;
   rectangle(b->x+b->w-5,y,3,thumb,1.5f,(b->foreground&0x00ffffff)|0x66000000);
  }
  if(b->h>4&&same_control(b,&scroll_focus)&&GetFocus()==window&&
     equal(snapshot,get(snapshot,style(b->node),"focusRing"),"true")){
   rectangle(b->x,b->y,b->w,2,0,b->foreground);
   rectangle(b->x,b->y+b->h-2,b->w,2,0,b->foreground);
   rectangle(b->x,b->y,2,b->h,0,b->foreground);
   rectangle(b->x+b->w-2,b->y,2,b->h,0,b->foreground);
  }
 }
 sk_canvas_restore(canvas);
}

#ifdef NATIVE_WASM_APP
enum { DEFAULT_CAPTION_HEIGHT = 36 };
static const UINT default_caption_commands[] = {SC_MINIMIZE, SC_MAXIMIZE, SC_CLOSE};

static float default_caption_button_width(void) {
 return fminf(46,(float)width/3);
}

static UINT default_caption_command(int x,int y) {
 if(titlebar_node||y<0||y>=chrome_height||x<0||x>=width)return 0;
 float button_width=default_caption_button_width();
 float left=width-3*button_width;
 return x<left?0:default_caption_commands[(int)((x-left)/button_width)];
}

static void draw_default_caption(void) {
 float button_width=default_caption_button_width(),left=width-3*button_width;
 uint32_t ink=document_light?0xff1f2328:0xfff3f5f8;
 SkRect bar={0,0,(float)width,chrome_height};
 sk_paint_set_color(paint,document_light?0xffe9ebee:0xff16181c);
 sk_canvas_draw_round_rect(canvas,&bar,0,0,paint);
 SkRect divider={0,chrome_height-1,(float)width,chrome_height};
 sk_paint_set_color(paint,document_light?0xffd0d4da:0xff2a2d33);
 sk_canvas_draw_round_rect(canvas,&divider,0,0,paint);
 if(left>12){
  SkRect text={12,0,left-4,chrome_height};
  sk_canvas_save(canvas);
  sk_canvas_clip_rect_with_operation(canvas,&text,1,false);
  sk_paint_set_color(paint,ink);
  const wchar_t *title=APP_TITLE;
  draw_text_units(title,wcslen(title),12,chrome_height/2+5,13,font);
  sk_canvas_restore(canvas);
 }
 for(int i=0;i<3;i++){
  UINT command=default_caption_commands[i];
  bool hover=command==hovered_caption_command;
  float x=left+i*button_width,y=floorf(chrome_height/2)+.5f;
  if(hover){
   bool down=command==pressed_caption_command;
   uint32_t background=command==SC_CLOSE?(down?0xffb91728:0xffd92739):
    document_light?(down?0xffcad1db:0xffd9dee6):(down?0xff414754:0xff2e333c);
   SkRect button={x,0,x+button_width,chrome_height-1};
   sk_paint_set_color(paint,background);
   sk_canvas_draw_round_rect(canvas,&button,0,0,paint);
  }
  x=floorf(x+button_width/2)+.5f;
  sk_paint_set_color(paint,hover&&command==SC_CLOSE?0xffffffff:ink);
  sk_paint_set_stroke_width(paint,1);
  if(command==SC_MINIMIZE){
   sk_canvas_draw_line(canvas,x-5,y,x+5,y,paint);
  }else if(command==SC_MAXIMIZE){
   if(IsZoomed(window)){
    sk_canvas_draw_line(canvas,x-2,y-6,x+6,y-6,paint);
    sk_canvas_draw_line(canvas,x+6,y-6,x+6,y+2,paint);
   }
   SkRect icon=IsZoomed(window)?(SkRect){x-5,y-3,x+3,y+5}:(SkRect){x-5,y-5,x+5,y+5};
   sk_paint_set_style(paint,1);
   sk_canvas_draw_round_rect(canvas,&icon,0,0,paint);
   sk_paint_set_style(paint,0);
  }else{
   sk_canvas_draw_line(canvas,x-5,y-5,x+5,y+5,paint);
   sk_canvas_draw_line(canvas,x+5,y-5,x-5,y+5,paint);
  }
 }
}

static void draw_window_border(void) {
 if(IsZoomed(window))return;
 const SkRect edges[] = {{0,0,(float)width,1},{0,height-1,(float)width,(float)height},
  {0,1,1,height-1},{width-1,1,(float)width,height-1}};
 sk_paint_set_color(paint,window_border_color);
 for(size_t i=0;i<sizeof(edges)/sizeof(*edges);i++)
  sk_canvas_draw_round_rect(canvas,&edges[i],0,0,paint);
}
#endif

static void native_pointer_frame(void);
static void draw(void){
 RECT r;GetClientRect(window,&r);int w=r.right,h=r.bottom;if(w<1||h<1)return;
 if(w!=width||h!=height||!surface){if(surface)sk_surface_unref(surface);free(pixels);width=w;height=h;pixels=calloc((size_t)w*h,4);SkInfo info={NULL,w,h,6,2};surface=sk_surface_new_raster_direct(&info,pixels,(size_t)w*4,NULL,NULL,NULL);if(!surface)fail("Native Skia could not allocate a raster surface");canvas=sk_surface_get_canvas(surface);}
 int previous_count=remember_nested_scroll();
 box_count=0;int tree=get(snapshot,1,"tree");
 viewport_height_in_flow=false;
 int document_props=props(tree);
 bool reduce_transparency=equal(snapshot,get(snapshot,document_props,"data-native-reduce-transparency"),"true");
 bool native_document=get(snapshot,document_props,"data-native-language")!=0;
 bool light=equal(snapshot,get(snapshot,document_props,"data-native-theme"),"light");
 document_scale=(float)number(snapshot,get(snapshot,document_props,"data-native-scale"),1);
 document_underline_links=equal(snapshot,get(snapshot,document_props,"data-native-underline-links"),"true");
 document_reduce_motion=equal(snapshot,get(snapshot,document_props,"data-native-reduce-motion"),"true");
 uint32_t root_background=tree?color(tree,"backgroundColor",0):0;
 document_light=light||light_color(root_background);
 /* An opaque root background also fills the window around the app. */
 uint32_t canvas_color=native_document?color(tree,"backgroundColor",0xff0b0c0f):
    (root_background>>24)==255?root_background:0xff0b0c0f;
 uint32_t foreground=native_document?color(tree,"color",0xfff3f5f8):
    color(tree,"color",document_light?0xff1f2328:0xfff3f5f8);
 sk_canvas_clear(canvas,canvas_color);
 titlebar_node=custom_window_frame?window_titlebar(tree):0;
 titlebar_box=-1;
 chrome_height=custom_window_frame?fminf(height,fmaxf(24,fminf(120,style_num(titlebar_node,"height",48)))):40;
#ifdef NATIVE_WASM_APP
 if(!titlebar_node)chrome_height=fminf(height,DEFAULT_CAPTION_HEIGHT);
#endif
 paint_top=chrome_height;
 float flow_top=chrome_height+12;
 float flow_height=tree?layout(tree,0,flow_top,(float)width,0,foreground):60;
 content_height=(int)flow_height+(int)(viewport_height_in_flow?flow_top:flow_top+8);
 animating_svg=false;
 if(!tree&&*native_status)text_lines(native_status,16,56,(float)width-32,16,foreground,1,1.4);
 if(scroll>content_height-height)scroll=content_height>height?content_height-height:0;
 if(tree)layout_viewport();
 if(titlebar_node){
  titlebar_box=box_count;
  laying_out_caption=true;
  layout_child(titlebar_node,0,scroll,(float)width,(float)width,0,foreground,false,chrome_height,0);
  laying_out_caption=false;
  boxes[titlebar_box].viewport_root=true;
  for(int i=titlebar_box;i<box_count;i++){
   boxes[i].viewport=true;
   boxes[i].caption=true;
   boxes[i].viewport_scroll=scroll;
  }
 }
 place_sheet_motion();
 place_overflow(previous_count);
 int enter_count=0,depth=0;
 struct DrawScope scopes[256];
 ULONGLONG now=GetTickCount64();
 if(custom_window_frame){
  SkRect client={0,chrome_height,(float)width,(float)height};
  sk_canvas_save(canvas);
  sk_canvas_clip_rect_with_operation(canvas,&client,1,false);
 }
 for(int i=0;i<box_count;i++){struct Box *b=&boxes[i];int node=b->node;wchar_t text[8192]={0};
  while(depth&&scopes[depth-1].end<=i)finish_draw_scope(scopes[--depth]);
  if(i==titlebar_box){
   sk_canvas_restore(canvas);
   SkRect caption={0,0,(float)width,chrome_height};
   sk_canvas_save(canvas);
   sk_canvas_clip_rect_with_operation(canvas,&caption,1,false);
   paint_top=0;
  }
  if(b->modal_root){
   float opacity=.5f;
   if(bottom_sheet(node)){
    float progress=active_sheet_motion()&&sheet_motion.height>0
     ? 1-fminf(1,fmaxf(0,sheet_motion.offset/sheet_motion.height)) : 1;
    opacity=reduce_transparency?.55f:.4f*progress;
    if(!reduce_transparency)blur_backdrop((SkRect){0,chrome_height,(float)width,(float)height},3*progress*document_scale);
   }
   rectangle(0,chrome_height+scroll,(float)width,height-chrome_height,0,(uint32_t)(opacity*255)<<24);
  }
  int end=b->end>i?b->end:i+1;
  if(b->kind!=9&&equal(snapshot,get(snapshot,style(node),"animateEnter"),"true")){
   ULONGLONG elapsed=now-enter_start(node,now,&enter_count);
   int duration=document_reduce_motion?160:350;
   if(elapsed<(ULONGLONG)duration){
    if(depth==256)fail("Too many nested drawing scopes");
    float time=(float)elapsed/duration;
    float amount=document_reduce_motion?1-(1-time)*(1-time):enter_ease(time);
    sk_paint_set_color(paint,(uint32_t)(amount*255)<<24);
    sk_canvas_save_layer(canvas,NULL,paint);
    if(!document_reduce_motion)sk_canvas_translate(canvas,0,6*document_scale*(1-amount));
    scopes[depth++]=(struct DrawScope){end,0};animating_svg=true;
   }
  }
  float opacity=(float)style_num(node,"opacity",1);
  if(pointer_pressed&&same_control(b,&pressed)){
   float scale=active_scale(b);
   opacity*=active_opacity(b);
   if(scale!=1){
    if(depth==256)fail("Too many nested drawing scopes");
    float cx=b->x+b->w/2,cy=b->y-scroll+b->h/2;
    sk_canvas_save(canvas);sk_canvas_translate(canvas,cx,cy);
    sk_canvas_scale(canvas,scale,scale);sk_canvas_translate(canvas,-cx,-cy);
    scopes[depth++]=(struct DrawScope){end,0};
   }
  }
  if(b->kind!=9&&opacity<1){
   if(depth==256)fail("Too many nested drawing scopes");
   sk_paint_set_color(paint,(uint32_t)(fmaxf(0,opacity)*255)<<24);
   sk_canvas_save_layer(canvas,NULL,paint);
   scopes[depth++]=(struct DrawScope){end,0};
  }
  if(b->list_bullet&&b->y-scroll+b->h>=paint_top&&b->y-scroll<height){
   sk_paint_set_color(paint,b->foreground);
   sk_canvas_draw_circle(canvas,b->x-7*document_scale,b->y-scroll+b->size*.62f,2*document_scale,paint);
  }
  if(b->kind!=9&&(b->scroll_region||equal(snapshot,get(snapshot,style(node),"clipOverflow"),"true"))){
   if(depth==256)fail("Too many nested drawing scopes");
   SkRect clip={b->x,b->y-scroll,b->x+b->w,b->y-scroll+b->h};
   float radius=(float)style_num(node,"borderRadius",0);
   sk_canvas_save(canvas);
   void *shape=box_corner_shape(node,&clip,radius,0);
   if(shape){
    sk_canvas_clip_rrect_with_operation(canvas,shape,1,true);
    sk_rrect_delete(shape);
   }else if(radius>0){
    void *path=sk_path_new();
    if(!path)fail("Cannot allocate native clipping path");
    sk_path_add_rounded_rect(path,&clip,radius,radius,0);
    sk_canvas_clip_path_with_operation(canvas,path,1,true);
    sk_path_delete(path);
   }else sk_canvas_clip_rect_with_operation(canvas,&clip,1,true);
   scopes[depth++]=(struct DrawScope){end,b->scroll_region?i+1:0};
  }
  if(b->kind==0||b->kind==10||b->kind==12){draw_backdrop(b);uint32_t bg=color(node,"backgroundColor",0);wchar_t ui[80];string(snapshot,get(snapshot,b->props,"data-ui"),ui,80);bool card=!wcscmp(ui,L"card");if(!bg&&card)bg=0xff15171b;if(bg)draw_box_fill(b,style_num(node,"borderRadius",card?18:0),bg);}
  else if(b->kind==5)chart(b);
  else if(b->kind==7)draw_icon(node,b->x,b->y-scroll,b->w,b->h,b->foreground);
  else if(b->kind==8||b->kind==6){
     uint32_t bg=color(node,"backgroundColor",0);
     if(bg)rectangle(b->x,b->y,b->w,b->h,style_num(node,"borderRadius",0),bg);
     struct Box area=text_region(b);
     if(b->kind==8)inline_layout(&area,true);
     else {
      wchar_t *label=node_text(node);
      void *selected=font_for(node,font);
      if(equal(snapshot,get(snapshot,style(node),"truncate"),"true"))truncate_text(label,area.w,area.size,selected);
      text_lines_aligned(label,area.x,area.y,area.w,area.size,
          color(node,"color",native_document||document_light?b->foreground:is(node,"Heading")?0xfff3f5f8:0xffb5b8be),1,
          style_num(node,"lineHeight",1.4),area.centered_text,selected);
      free(label);
     }
  }
  else if(b->kind==9){if(key_focus.kind&&same_control(b,&key_focus))draw_focus_ring(b);continue;}
  else if(b->kind==11)rectangle(b->x,b->y,b->w,b->h,0,b->foreground);
  else{
   bool window_button=b->kind==1&&get(snapshot,b->props,"data-native-window-command");
   bool styled_button=b->kind==1&&(window_button||get(snapshot,b->props,"nativeVariants"));
   int disabled=equal(snapshot,get(snapshot,b->props,"disabled"),"true");
   uint32_t bg=color(node,"backgroundColor",default_control_fill(b->kind,styled_button));
   if(disabled&&!styled_button)bg=document_light?0xfff1f2f4:0xff34373c;
   float radius=(float)style_num(node,"borderRadius",document_light?6:16);
   if(bg){
    if(window_button)draw_box_fill(b,radius,bg);
    else rectangle(b->x,b->y,b->w,b->h,radius,bg);
   }
   if(!window_button&&!styled_button)draw_default_control_border(b,radius,disabled);
   if(b->kind==1)collect_text(node,text,8192);else{int val=get(snapshot,b->props,"value");if(val&&snapshot->t[val].type!='"'){char rawvalue[80];raw(snapshot,val,rawvalue,80);MultiByteToWideChar(CP_UTF8,0,rawvalue,-1,text,8192);}else string(snapshot,val,text,8192);
    if(b->kind==3){int a=get(snapshot,node,"children");for(int c=a+1;a&&c<snapshot->t[a].next;c=snapshot->t[c].next){wchar_t option[8192];string(snapshot,get(snapshot,props(c),"value"),option,8192);if(!wcscmp(option,text)){*text=0;collect_text(c,text,8192);break;}}}
    if(equal(snapshot,get(snapshot,b->props,"type"),"password"))for(size_t k=0;k<wcslen(text);k++)text[k]=0x2022;
    if(!*text)string(snapshot,get(snapshot,b->props,"placeholder"),text,8192);
   }
   float padding=window_button?(float)style_num(node,"padding",4):12;
   float left=(float)style_num(node,"paddingLeft",padding),right=(float)style_num(node,"paddingRight",padding);
   float top=window_button?(float)style_num(node,"paddingTop",padding):0;
   float bottom=window_button?(float)style_num(node,"paddingBottom",padding):0;
   float inner_height=fmaxf(0,b->h-top-bottom);
   float tx=b->x+left, available=fmaxf(1,b->w-left-right);
   float size=b->size;
   void *selected=styled_button?font_for(node,font):font;
   uint32_t foreground=color(node,"color",styled_button?b->foreground:b->kind==1?0xff07111b:
      document_light?0xff1f2328:0xfff3f5f8);
   if(disabled&&!styled_button&&document_light&&!get(snapshot,style(node),"color"))foreground=0xff8a9099;
   if(b->kind==1){
      int children=get(snapshot,node,"children"), icon=0;
      if(children)for(int child=children+1;child<snapshot->t[children].next;child=snapshot->t[child].next)
         if(is(child,"Svg")){if(icon)fail("Native button supports one inline SVG");icon=child;}
      float icon_width=icon?(float)style_num(icon,"width",24):0;
      float reserved=icon?icon_width+8:0;
      available-=reserved;
      transform_text(text,get(snapshot,style(node),"textTransform"));
      while(size>10&&measure_font(text,size,selected)>available)size-=.5f;
      float measured=measure_font(text,size,selected)+reserved;
      if(measured<b->w-left-right)
         tx=window_button?b->x+left+(b->w-left-right-measured)/2:b->x+(b->w-measured)/2;
      if(icon){
         float icon_height=(float)style_num(icon,"height",24);
         draw_icon(icon,tx,b->y+top+(inner_height-icon_height)/2-scroll,icon_width,icon_height,foreground);
         tx+=reserved;
      }
   }
   float ty=b->y+(b->kind==1?top+fmaxf(0,(inner_height-size*1.4f)/2):12);
   if(b->kind==1&&equal(snapshot,get(snapshot,style(node),"whiteSpace"),"nowrap")){
      SkRect clip={b->x,b->y-scroll,b->x+b->w,b->y-scroll+b->h};
      sk_canvas_save(canvas);
      sk_canvas_clip_rect_with_operation(canvas,&clip,1,false);
      sk_paint_set_color(paint,foreground);
      draw_text_units(text,wcslen(text),tx,ty-scroll+size,size,selected);
      sk_canvas_restore(canvas);
   }else text_lines_aligned(text,tx,ty,available,size,foreground,1,1.4,false,selected);
  }
  if(node)draw_border(b);
  if(node&&key_focus.kind&&same_control(b,&key_focus))draw_focus_ring(b);
 }
 while(depth)finish_draw_scope(scopes[--depth]);
 memcpy(enter_before,enter_now,(size_t)enter_count*sizeof(*enter_before));
 enter_before_count=enter_count;
 if(custom_window_frame){
  sk_canvas_restore(canvas);
  paint_top=chrome_height;
#ifdef NATIVE_WASM_APP
  if(!titlebar_node)draw_default_caption();
#endif
 }else{
 /* Default window chrome for apps without a WindowTitleBar follows the app's
  * light or dark root background, with a divider above the content. */
 SkRect banner={0,0,(float)width,40};sk_paint_set_color(paint,document_light?0xffe9ebee:0xff16181c);sk_canvas_draw_round_rect(canvas,&banner,0,0,paint);
 SkRect divider={0,39,(float)width,40};sk_paint_set_color(paint,document_light?0xffd0d4da:0xff2a2d33);sk_canvas_draw_round_rect(canvas,&divider,0,0,paint);
 sk_paint_set_color(paint,document_light?(native_document?foreground:0xff3a3f47):0xffc3c6cc);sk_font_set_size(font,12);const wchar_t *notice=APP_BANNER;sk_canvas_draw_simple_text(canvas,notice,wcslen(notice)*2,1,12,25,font,paint);
 }
 if(tree&&*native_status&&height>chrome_height+46){
  float y=height-46+scroll;
  rectangle(0,y,(float)width,46,0,0xff25202a);
  text_lines(native_status,12,y+8,(float)width-24,14,0xfff3f5f8,1,1.4);
 }
 if(!custom_window_frame){
  SCROLLINFO si={sizeof(si),SIF_RANGE|SIF_PAGE|SIF_POS,0,content_height-1,(UINT)height,scroll,0};
  SetScrollInfo(window,SB_VERT,&si,TRUE);
 }
 if(animating_svg)SetTimer(window,2,16,NULL);else KillTimer(window,2);
 if(editor&&editing){
  int n=find_identity(tree,edit_id,edit_native_id);
  if(n)sync_editor_value(n);
  bool visible=false;
  for(int i=0;i<box_count;i++)if(boxes[i].node==n){
   struct Box *b=&boxes[i];
   float y=b->y-box_scroll(b);
   int modal=modal_box_index();
   visible=!equal(snapshot,get(snapshot,b->props,"disabled"),"true")&&
    (modal<0||(i>modal&&i<boxes[modal].end))&&y>=chrome_height&&y+b->h<=height&&(!b->clipped||
    (b->x>=b->clip.left&&b->x+b->w<=b->clip.right&&b->y>=b->clip.top&&b->y+b->h<=b->clip.bottom));
   for(int j=i+1;visible&&j<box_count;j++)if(boxes[j].viewport_root){
    struct Box *overlay=&boxes[j];
    float top=overlay->y-box_scroll(overlay);
    if(b->x<overlay->x+overlay->w&&b->x+b->w>overlay->x&&y<top+overlay->h&&y+b->h>top)visible=false;
   }
   if(visible)MoveWindow(editor,b->x+10,y+9,b->w-20,b->h-18,TRUE);
   break;
  }
  ShowWindow(editor,visible?SW_SHOW:SW_HIDE);
 }
#ifdef NATIVE_WASM_APP
 draw_window_border();
#endif
 native_pointer_frame();
}
