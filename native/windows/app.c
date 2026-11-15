#define UNICODE
#define _UNICODE
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <windowsx.h>
#include <commdlg.h>
#include <stdint.h>
#include <stdbool.h>
#include <math.h>
#include "json.h"
#include "skia.h"
#include "svg.h"
#ifndef NATIVE_WASM_APP
int reactc_core_main(int,char**);
#endif
#ifndef NATIVE_APP_TITLE
#define NATIVE_APP_TITLE L"Native App"
#endif
#if !defined(NATIVE_WASM_APP) && !defined(NATIVE_CORE_IN_PROCESS)
#define NATIVE_CORE_IN_PROCESS
#endif
#include "reactc-http.h"
#include "reactc-browser.h"
#include "reactc-window.h"
#define APP_TITLE NATIVE_APP_TITLE
#define APP_BANNER NATIVE_APP_TITLE
#define APP_LOG "native-app-error.log"
#define APP_CORE_NAME "native-app"
#define APP_LOAD_ERROR L""
static HWND window,editor;
static HMODULE skia;
static HANDLE job;
static wchar_t library_dir[MAX_PATH],library_path[MAX_PATH];
#ifdef NATIVE_WASM_APP
static wchar_t runtime_path[MAX_PATH], module_path[MAX_PATH];
#endif
static struct Json *snapshot,*reply;
static int changing,editing,scroll,content_height,width=430,height=850,box_count;
enum { BOX_ID_CAPACITY = 1024 };
static wchar_t edit_id[BOX_ID_CAPACITY];
static bool edit_native_id;
static void *surface,*canvas,*paint,*font,*face,*bold_font,*mono_font,*italic_font,*bold_italic_font;
static unsigned *pixels;
static HFONT edit_font;
static WNDPROC edit_procedure;
static int smoke;
static bool animating_svg;
static bool document_underline_links;
static bool document_reduce_motion;
/* True when the app's root background (or its native theme) is light; the
 * default control and window-chrome colours follow it. */
static bool document_light;
static float document_scale = 1;
/* Bytes read past the end of one protocol line stay buffered for the next. */
struct Peer {HANDLE input,output,process;char pending[65536];size_t pending_start,pending_end;};
static struct Peer core,fixture;
#ifdef NATIVE_CORE_IN_PROCESS
#include "core-channel.h"
#endif
struct Box {int node,props;float x,y,w,h,size;int kind,end;wchar_t public_id[BOX_ID_CAPACITY];uint32_t foreground;bool centered_text,native_id,list_bullet,clipped;SkRect clip;float text_offset;bool viewport,viewport_root,modal_root,caption;int viewport_scroll;bool scroll_region;float scroll_offset,scroll_max;};
static struct Box boxes[4096];
static struct Box pressed;
static bool pointer_pressed;
static bool custom_window_frame;
static int titlebar_node, titlebar_box = -1;
enum { WINDOW_LICENSES = 0x1f10 };
static float chrome_height = 40, paint_top = 40;
#include "sheet-motion.h"
static struct SheetMotion sheet_motion;
static wchar_t sheet_id[BOX_ID_CAPACITY];
static bool reset_nested_scroll;
static struct Box scroll_focus;
/* Button or link focused from the keyboard (Tab); drawn with a focus ring. */
static struct Box key_focus;
/* A key the page saw first is replayed later; its default action uses the
 * modifiers captured when it was pressed, not the state at replay time. */
enum { KEY_SHIFT = 1, KEY_CTRL = 2, KEY_ALT = 4 };
static int replay_modifiers = -1;
static bool key_consumed;  /* set when a default action handled WM_KEYDOWN */
static int current_modifiers(void) {
    return (GetKeyState(VK_SHIFT) < 0 ? KEY_SHIFT : 0) | (GetKeyState(VK_CONTROL) < 0 ? KEY_CTRL : 0) |
        (GetKeyState(VK_MENU) < 0 ? KEY_ALT : 0);
}
static bool modifier_down(int key) {
    int flag = key == VK_SHIFT ? KEY_SHIFT : key == VK_CONTROL ? KEY_CTRL : KEY_ALT;
    return ((replay_modifiers >= 0 ? replay_modifiers : current_modifiers()) & flag) != 0;
}
static _Thread_local bool on_native_worker;
static bool native_busy = true, native_stopped, native_frame_ready;
static wchar_t native_status[512] = L"Loading…";
static void broker_fail(const char *message);
struct ScrollRequest {struct ScrollRequest *next;size_t length;int box;char id[];};
static struct ScrollRequest *first_scroll_request,*last_scroll_request;

static void clear_scroll_requests(void){
 while(first_scroll_request){
  struct ScrollRequest *request=first_scroll_request;
  first_scroll_request=request->next;
  free(request);
 }
 last_scroll_request=NULL;
}

static void update_route_scroll(void);
static void queue_scroll_requests(void);
static const wchar_t *routes[]={L"/"};
static void stop_peer(struct Peer *p){if(p->input)CloseHandle(p->input);p->input=NULL;if(p->process){if(WaitForSingleObject(p->process,1500)!=WAIT_OBJECT_0)TerminateProcess(p->process,1);CloseHandle(p->process);}if(p->output)CloseHandle(p->output);memset(p,0,sizeof(*p));}
static void cleanup(void){
 clear_scroll_requests();
 stop_peer(&core);stop_peer(&fixture);if(job)CloseHandle(job);if(surface)sk_surface_unref(surface);if(font)sk_font_delete(font);if(bold_font)sk_font_delete(bold_font);if(mono_font)sk_font_delete(mono_font);if(italic_font)sk_font_delete(italic_font);if(bold_italic_font)sk_font_delete(bold_italic_font);if(paint)sk_paint_delete(paint);if(face)sk_typeface_unref(face);if(skia)FreeLibrary(skia);if(*library_path)DeleteFileW(library_path);
#ifdef NATIVE_WASM_APP
 if(*runtime_path)DeleteFileW(runtime_path);
 if(*module_path)DeleteFileW(module_path);
#endif
 if(*library_dir)RemoveDirectoryW(library_dir);
}
static void fail(const char *message){
 if(on_native_worker){broker_fail(message);return;}
 FILE *f=fopen(APP_LOG,"a");if(f){fprintf(f,"%s (Windows error %lu)\n",message,GetLastError());fclose(f);}
 wchar_t wide[1024];MultiByteToWideChar(CP_UTF8,0,message,-1,wide,1024);
 MessageBoxW(window,wide,APP_TITLE,MB_ICONERROR|MB_OK);
 cleanup();ExitProcess(1);
}
#ifdef NATIVE_WASM_APP
static void unpack_wasm(int id, const wchar_t *name, wchar_t *path){
 if(swprintf(path,MAX_PATH,L"%ls\\%ls",library_dir,name)<0)fail("Embedded WASM directory path is too long");
 HRSRC resource=FindResourceW(NULL,MAKEINTRESOURCEW(id),RT_RCDATA);
 if(!resource)fail("Embedded WASM resource missing");
 HGLOBAL loaded=LoadResource(NULL,resource);
 DWORD size=SizeofResource(NULL,resource),written=0;
 const void *bytes=loaded?LockResource(loaded):NULL;
 HANDLE file=CreateFileW(path,GENERIC_WRITE,0,NULL,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,NULL);
 if(file==INVALID_HANDLE_VALUE)fail("Cannot create embedded WASM file");
 bool success=bytes&&size&&WriteFile(file,bytes,size,&written,NULL)&&written==size;
 CloseHandle(file);
 if(!success)fail("Cannot unpack embedded WASM file");
}

static void core_start(void){
 unpack_wasm(103,L"wasmtime.exe",runtime_path);
 unpack_wasm(104,L"app.wasm",module_path);
 struct Peer p={0};SECURITY_ATTRIBUTES sa={sizeof(sa),NULL,TRUE};HANDLE input,output;
 if(!CreatePipe(&input,&p.input,&sa,0)||!CreatePipe(&p.output,&output,&sa,0))fail("Cannot create native protocol pipes");
 SetHandleInformation(p.input,HANDLE_FLAG_INHERIT,0);SetHandleInformation(p.output,HANDLE_FLAG_INHERIT,0);
 STARTUPINFOW si={0};si.cb=sizeof(si);si.dwFlags=STARTF_USESTDHANDLES|STARTF_USESHOWWINDOW;si.wShowWindow=SW_HIDE;
 HANDLE errors=CreateFileW(L"NUL",GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,&sa,OPEN_EXISTING,0,NULL);
 if(errors==INVALID_HANDLE_VALUE)fail("Cannot open WASM diagnostics stream");
 si.hStdInput=input;si.hStdOutput=output;si.hStdError=errors;
 wchar_t command[2*MAX_PATH+100];
 swprintf(command,2*MAX_PATH+100,L"\"%ls\" run -W exceptions=y -O opt-level=0 \"%ls\"",runtime_path,module_path);
 PROCESS_INFORMATION info;
 BOOL started=CreateProcessW(runtime_path,command,NULL,NULL,TRUE,CREATE_NO_WINDOW,NULL,NULL,&si,&info);
 CloseHandle(input);CloseHandle(output);CloseHandle(errors);
 if(!started)fail("Cannot start embedded Wasmtime");
 CloseHandle(info.hThread);p.process=info.hProcess;
 core=p;
 if(job&&!AssignProcessToJobObject(job,p.process))fail("Cannot attach native child to application job");
}
#endif
/* Set REACTC_TIMING=1 to append per-step durations to reactc-timing.log. */
static double timing_now(void){LARGE_INTEGER count,frequency;QueryPerformanceCounter(&count);QueryPerformanceFrequency(&frequency);return count.QuadPart*1000.0/frequency.QuadPart;}
static void timing_log(const char *step,double started){
 static _Thread_local int enabled=-1;
 if(enabled<0)enabled=GetEnvironmentVariableW(L"REACTC_TIMING",NULL,0)>0;
 if(!enabled)return;
 FILE *f=fopen("reactc-timing.log","a");if(f){fprintf(f,"%s %.1f ms\n",step,timing_now()-started);fclose(f);}
}
static void receive(struct Peer *p,struct Json *d){
#ifdef NATIVE_CORE_IN_PROCESS
 if(p==&core){
  core_receive(d->text,JSON_BYTES);parse(d);
  return;
 }
#endif
 /* Take whatever the pipe holds in one read. An empty pipe is polled by
    yielding first: Sleep(1) lasts a whole scheduler tick (about 15 ms) on
    Windows, and a reply usually arrives in many small writes. */
 size_t len=0;ULONGLONG deadline=GetTickCount64()+60000;unsigned idle=0;bool complete=false;
 while(!complete){
  if(p->pending_start==p->pending_end){
   DWORD available=0,n=0;if(!PeekNamedPipe(p->output,NULL,0,NULL,&available,NULL))fail("Native subprocess pipe closed");
   if(!available){
    if(GetTickCount64()>deadline||WaitForSingleObject(p->process,0)==WAIT_OBJECT_0)fail("Native subprocess stopped responding");
    if(++idle<4000)SwitchToThread();else Sleep(1);
    continue;
   }
   idle=0;
   if(available>sizeof(p->pending))available=sizeof(p->pending);
   if(!ReadFile(p->output,p->pending,available,&n,NULL)||!n)fail("Native subprocess exited unexpectedly");
   p->pending_start=0;p->pending_end=n;
  }
  const char *from=p->pending+p->pending_start;size_t size=p->pending_end-p->pending_start;
  const char *newline=memchr(from,'\n',size);size_t take=newline?(size_t)(newline-from):size;
  if(len+take+1>=JSON_BYTES)fail("Native snapshot exceeds 2 MiB");
  memcpy(d->text+len,from,take);len+=take;p->pending_start+=take+(newline?1:0);complete=newline!=NULL;
 }d->text[len]=0;parse(d);
}
static void send_peer(struct Peer *p,const char *command,struct Json *d){
 // Both compiled services accept bounded ASCII-escaped JSON, never raw UTF-8.
 double started=timing_now();
 int units=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,command,-1,NULL,0);
 if(!units)fail("Invalid UTF-8 in native command");wchar_t *wide=malloc((size_t)units*2);char *ascii=malloc(JSON_BYTES);if(!wide||!ascii)fail("Cannot allocate command encoder");
 MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,command,-1,wide,units);size_t used=0;
 for(int i=0;i<units-1;i++){unsigned c=wide[i];if(used+7>=262144)fail("Native command exceeds 256 KiB");if(c>127){snprintf(ascii+used,7,"\\u%04x",c);used+=6;}else ascii[used++]=(char)c;}ascii[used]=0;free(wide);command=ascii;
 DWORD n;size_t length=used,at=0;
#ifdef NATIVE_CORE_IN_PROCESS
 if(p==&core){core_send(command,length);free(ascii);receive(p,d);timing_log("core round trip",started);return;}
#endif
 while(at<length){if(!WriteFile(p->input,command+at,(DWORD)(length-at),&n,NULL)||!n)fail("Cannot write native command");at+=n;}
 if(!WriteFile(p->input,"\n",1,&n,NULL))fail("Cannot terminate native command");free(ascii);receive(p,d);timing_log("core round trip",started);
}

enum { CORE_TIMER = 3 };
static const char core_tick[] = "{\"type\":\"tick\"}";

static double core_clock_now(void) {
    FILETIME time;
    GetSystemTimeAsFileTime(&time);
    ULARGE_INTEGER ticks = {.LowPart = time.dwLowDateTime, .HighPart = time.dwHighDateTime};
    // FILETIME uses the 1601 epoch and 100 ns units. The core uses Unix milliseconds.
    return (double)(ticks.QuadPart / 10000) - 11644473600000.0;
}

static int core_timer_delay_for(struct Json *document) {
    int token = get(document, 1, "wakeAt");
    if (!token) return -1;
    double wake_at = number(document, token, -1);
    if (!isfinite(wake_at) || wake_at < 0 || wake_at > 9007199254740991.0)
        fail("Invalid native timer deadline");
    return (int)fmin(fmax(0, ceil(wake_at - core_clock_now())), USER_TIMER_MAXIMUM);
}

static void arm_core_timer(HWND hwnd) {
    if (!hwnd) return;
    KillTimer(hwnd, CORE_TIMER);
    if (native_busy || native_stopped || *native_status) return;
    int delay = core_timer_delay_for(snapshot);
    if (delay >= 0 && !SetTimer(hwnd, CORE_TIMER, (UINT)delay, NULL))
        fail("Cannot schedule native application timer");
}

static void update_route_scroll(void) {
    static wchar_t current[2049];
    int route = get(snapshot, 1, "route");
    if (!route) return;
    wchar_t path[2049];
    string(snapshot, route, path, sizeof(path) / sizeof(*path));
    if (!wcscmp(current, path)) return;
    wcscpy(current, path);
    scroll = 0;
    reset_nested_scroll = true;
    scroll_focus = (struct Box){0};
    clear_scroll_requests();
}

static void queue_scroll_requests(void){
 int array=get(snapshot,1,"scrollIntoView");
 if(!array)return;
 if(snapshot->t[array].type!='[')fail("Invalid native scroll commands");
 for(int i=array+1;i<snapshot->t[array].next;i=snapshot->t[i].next){
  const struct Token token=snapshot->t[i];
  if(token.type!='"')fail("Invalid native scroll target");
  size_t length=token.end-token.start;
  struct ScrollRequest *request=malloc(sizeof(*request)+length);
  if(!request)fail("Cannot allocate native scroll target");
  request->next=NULL;
  request->length=length;
  request->box=-1;
  memcpy(request->id,snapshot->text+token.start,length);
  if(last_scroll_request)last_scroll_request->next=request;
  else first_scroll_request=request;
  last_scroll_request=request;
 }
}

#include "reactc-broker.h"


static void sync_editor_value(int node);
static void close_editor(void);
#include "renderer.h"
#include "reactc-events.h"
static void send_control_event(int node,const char *kind,const char *fields){
 native_enqueue(node,kind,fields,NULL);
}
static void event(int node,const char *kind,const wchar_t *value){
 char fields[65536]="\"value\":";
 quote(value?value:L"",fields+8,sizeof(fields)-8);
 send_control_event(node,kind,fields);
}
static bool dismiss_active_modal(void){
 int node=active_modal_node();
 if(!node)return false;
 if(get(snapshot,props(node),"dismiss"))event(node,"dismiss",NULL);
 return true;
}
static bool request_overlay_dismiss(void){
 if(!active_modal_node())return false;
 if(!active_sheet_motion()||document_reduce_motion)return dismiss_active_modal();
 if(!sheet_motion.closing){
  bool captured=sheet_motion.dragging;
  sheet_motion.dragging=false;
  sheet_motion.closing=true;
  sheet_animate(&sheet_motion,sheet_motion.height,sheet_motion.velocity,1,GetTickCount64());
  if(captured&&GetCapture()==window)ReleaseCapture();
  InvalidateRect(window,NULL,FALSE);
 }
 return true;
}
static void close_editor(void){
 if(editor){
  native_editor_epoch++;
  DestroyWindow(editor);editor=NULL;
 }
 editing=0;
 native_send_interaction();
}
static void navigate(const wchar_t *route){
 close_editor();char encoded[2048],command[2200];
 quote(route,encoded,sizeof(encoded));
 snprintf(command,sizeof(command),"{\"type\":\"navigate\",\"path\":%s}",encoded);
 native_enqueue(0,NULL,command,NULL);
}

static void snapshot_editor_value(int node,wchar_t value[8192]){
 int token=get(snapshot,props(node),"value");
 if(token&&snapshot->t[token].type!='"'){
  char numeric[80];raw(snapshot,token,numeric,sizeof(numeric));
  MultiByteToWideChar(CP_UTF8,0,numeric,-1,value,8192);
 }else string(snapshot,token,value,8192);
}

static void editor_text(wchar_t value[8192]){
 GetWindowTextW(editor,value,8192);
 wchar_t *output=value;
 for(const wchar_t *input=value;*input;input++){
  if(*input==L'\r'&&input[1]==L'\n')continue;
  *output++=*input==L'\r'?L'\n':*input;
 }
 *output=0;
}

static void set_editor_text(const wchar_t *value,bool preserve_selection){
 wchar_t native[16384],*output=native;
 for(const wchar_t *input=value;*input;input++){
  if(editing==4&&*input==L'\n'&&(input==value||input[-1]!=L'\r'))*output++=L'\r';
  *output++=*input;
 }
 *output=0;
 DWORD start=(DWORD)(output-native),end=start;
 if(preserve_selection)SendMessageW(editor,EM_GETSEL,(WPARAM)&start,(LPARAM)&end);
 changing=1;
 SetWindowTextW(editor,native);
 SendMessageW(editor,EM_SETSEL,start,end);
 changing=0;
}

static void sync_editor_value(int node){
 if(!editor)return;
 if(native_busy||native_head)return;
 int p=props(node);
 bool readonly=equal(snapshot,get(snapshot,p,"readOnly"),"true");
 if(readonly!=((GetWindowLongPtrW(editor,GWL_STYLE)&ES_READONLY)!=0))
  SendMessageW(editor,EM_SETREADONLY,readonly,0);
 if(!get(snapshot,p,"value"))return;
 wchar_t value[8192],actual[8192];
 snapshot_editor_value(node,value);
 editor_text(actual);
 if(wcscmp(value,actual))set_editor_text(value,true);
}

static bool editor_enter(const MSG *message,bool shift,bool ctrl,bool alt,bool meta,bool repeat){
 if(message->hwnd!=editor||editing!=4)return false;
 int node=find_identity(get(snapshot,1,"tree"),edit_id,edit_native_id);
 if(!node){close_editor();return true;}
 int p=props(node);
 if(!get(snapshot,p,"keyDown"))return false;
 if(equal(snapshot,get(snapshot,p,"disabled"),"true")||
    equal(snapshot,get(snapshot,p,"readOnly"),"true"))return true;
 char fields[192];
 snprintf(fields,sizeof(fields),"\"key\":\"Enter\",\"shiftKey\":%s,\"ctrlKey\":%s,\"altKey\":%s,\"metaKey\":%s,\"repeat\":%s",
  shift?"true":"false",ctrl?"true":"false",alt?"true":"false",meta?"true":"false",repeat?"true":"false");
 return native_enqueue(node,"keyDown",fields,message);
}

static bool context_menu_event(int node,POINT client,const MSG *fallback){
 int modal=active_modal_node(),p=props(node);
 if(!node||!get(snapshot,p,"contextMenu")||equal(snapshot,get(snapshot,p,"disabled"),"true"))return false;
 if(modal&&(node<modal||node>=snapshot->t[modal].next))return false;
 char fields[96];
 snprintf(fields,sizeof(fields),"\"clientX\":%ld,\"clientY\":%ld",(long)client.x,(long)client.y);
 return native_enqueue(node,"contextMenu",fields,fallback);
}

static bool editor_key_default(HWND hwnd,UINT message,WPARAM key);
static LRESULT CALLBACK editor_window_proc(HWND hwnd,UINT message,WPARAM wp,LPARAM lp){
 if((message==WM_KEYDOWN||message==WM_CHAR)&&editor_key_default(hwnd,message,wp)){if(message==WM_KEYDOWN)key_consumed=true;return 0;}
 if(message==WM_CONTEXTMENU){
  POINT point={GET_X_LPARAM(lp),GET_Y_LPARAM(lp)};
  if(point.x==-1&&point.y==-1){
   point=(POINT){0,0};
   GetCaretPos(&point);
   ClientToScreen(hwnd,&point);
  }
  ScreenToClient(window,&point);
  int node=find_identity(get(snapshot,1,"tree"),edit_id,edit_native_id);
  MSG fallback={.hwnd=hwnd,.message=message,.wParam=wp,.lParam=lp};
  if(context_menu_event(node,point,&fallback)||!IsWindow(hwnd))return 0;
 }
 return CallWindowProcW(edit_procedure,hwnd,message,wp,lp);
}

static void open_editor(struct Box *b){close_editor();editing=b->kind;edit_native_id=b->native_id;wcscpy(edit_id,b->public_id);if(!*edit_id)fail("Editable control has no identity");
 wchar_t value[8192];snapshot_editor_value(b->node,value);DWORD flags=WS_CHILD|WS_VISIBLE|WS_TABSTOP|ES_AUTOHSCROLL;if(b->kind==4)flags|=ES_MULTILINE|ES_AUTOVSCROLL|ES_WANTRETURN|WS_VSCROLL;
 if(equal(snapshot,get(snapshot,b->props,"type"),"password"))flags|=ES_PASSWORD;
 if(equal(snapshot,get(snapshot,b->props,"readOnly"),"true"))flags|=ES_READONLY;
 changing=1;editor=CreateWindowExW(0,L"EDIT",L"",flags,b->x+10,b->y-box_scroll(b)+9,b->w-20,b->h-18,window,(HMENU)200,GetModuleHandleW(NULL),NULL);if(!editor)fail("Cannot create Windows native text input");
 edit_procedure=(WNDPROC)SetWindowLongPtrW(editor,GWLP_WNDPROC,(LONG_PTR)editor_window_proc);
 if(!edit_procedure)fail("Cannot install Windows editor event handler");
 SendMessageW(editor,EM_SETLIMITTEXT,8191,0);SendMessageW(editor,WM_SETFONT,(WPARAM)edit_font,TRUE);set_editor_text(value,false);SetFocus(editor);
 native_send_interaction();
}
static void activate(struct Box *b){
 // WM_PAINT is lower priority than input. Resolve the stable public ID against
 // the latest snapshot before using handler tokens from the last drawn frame.
 int node=find_identity(get(snapshot,1,"tree"),b->public_id,b->native_id);
 if(!node){InvalidateRect(window,NULL,FALSE);return;}
 struct Box live=*b;live.node=node;live.props=props(node);b=&live;
 if(equal(snapshot,get(snapshot,b->props,"disabled"),"true")||
    ((b->kind!=2&&b->kind!=4)&&equal(snapshot,get(snapshot,b->props,"readOnly"),"true")))return;
 if(equal(snapshot,get(snapshot,b->props,"data-native-sheet-dismiss"),"true")&&request_overlay_dismiss())return;
 if(b->kind==1||b->kind==9||b->kind==10||b->kind==12){close_editor();event(b->node,"press",NULL);}
 else if(b->kind==2||b->kind==4)open_editor(b);
 else if(b->kind==3){close_editor();HMENU menu=CreatePopupMenu();int a=get(snapshot,b->node,"children"),nodes[128],count=0;for(int c=a+1;a&&c<snapshot->t[a].next&&count<128;c=snapshot->t[c].next){wchar_t label[1024]={0};collect_text(c,label,1024);nodes[count++]=c;AppendMenuW(menu,MF_STRING,count,label);}POINT point={(int)b->x,(int)(b->y+b->h-scroll)};ClientToScreen(window,&point);int choice=TrackPopupMenu(menu,TPM_RETURNCMD|TPM_NONOTIFY,point.x,point.y,0,window,NULL);DestroyMenu(menu);if(choice){wchar_t value[1024];string(snapshot,get(snapshot,props(nodes[choice-1]),"value"),value,1024);event(b->node,"change",value);}}
}
static struct Box *box_id(const wchar_t *id){int node=find_node(get(snapshot,1,"tree"),id);for(int i=0;i<box_count;i++)if(boxes[i].node==node)return &boxes[i];fail("Smoke test control missing");return NULL;}
/* Saves the settled startup frame and its snapshot, then closes. */
static void smoke_test(void){
 draw();
 FILE *image=fopen("native-app-smoke.bmp","wb");if(!image)fail("Cannot save smoke image");BITMAPFILEHEADER bh={0};BITMAPINFOHEADER bi={sizeof(bi),width,-height,1,32,BI_RGB,0,0,0,0,0};bh.bfType=0x4d42;bh.bfOffBits=sizeof(bh)+sizeof(bi);bh.bfSize=bh.bfOffBits+(DWORD)width*height*4;fwrite(&bh,sizeof(bh),1,image);fwrite(&bi,sizeof(bi),1,image);fwrite(pixels,4,(size_t)width*height,image);fclose(image);
 FILE *file=fopen("native-app-smoke.json","wb");if(!file)fail("Cannot save smoke snapshot");fputs(snapshot->text,file);fclose(file);
 PostMessageW(window,WM_CLOSE,0,0);
}
static UINT caption_command(int node) {
 int value=get(snapshot,props(node),"data-native-window-command");
 if(equal(snapshot,value,"minimize"))return SC_MINIMIZE;
 if(equal(snapshot,value,"maximize"))return SC_MAXIMIZE;
 if(equal(snapshot,value,"close"))return SC_CLOSE;
 if(equal(snapshot,value,"licenses"))return WINDOW_LICENSES;
 return 0;
}

static struct Box *caption_control(int x,int y) {
 if(titlebar_box<0||y<0||y>=chrome_height)return NULL;
 for(int i=box_count-1;i>titlebar_box;i--){
  struct Box *box=&boxes[i];
  if((box->kind==1||box->kind==9||box->kind==10)&&in_box(box,x,y))return box;
 }
 return NULL;
}

static LRESULT frame_hit_test(HWND hwnd,LPARAM point) {
 POINT screen={GET_X_LPARAM(point),GET_Y_LPARAM(point)};
 RECT rect;
 GetWindowRect(hwnd,&rect);
 if(!IsZoomed(hwnd)){
  int edge=GetSystemMetrics(SM_CXPADDEDBORDER);
  int horizontal=GetSystemMetrics(SM_CXSIZEFRAME)+edge;
  int vertical=GetSystemMetrics(SM_CYSIZEFRAME)+edge;
  bool left=screen.x<rect.left+horizontal,right=screen.x>=rect.right-horizontal;
  if(screen.y<rect.top+vertical)return left?HTTOPLEFT:right?HTTOPRIGHT:HTTOP;
  if(screen.y>=rect.bottom-vertical)return left?HTBOTTOMLEFT:right?HTBOTTOMRIGHT:HTBOTTOM;
  if(left||right)return left?HTLEFT:HTRIGHT;
 }
 ScreenToClient(hwnd,&screen);
 if(screen.y>=0&&screen.y<chrome_height&&!caption_control(screen.x,screen.y))return HTCAPTION;
 return HTCLIENT;
}

#include "keyboard.h"
static LRESULT CALLBACK procedure(HWND hwnd,UINT message,WPARAM wp,LPARAM lp){
 static int hovered_link;
 static UINT pressed_caption_command;
 switch(message){
 case REACTC_FRAME:native_apply_frame(hwnd,(struct ReactcFrame *)lp);return 0;
 case REACTC_BROWSER_DIALOG:return reactc_browser_dialog(hwnd,(const struct ReactcBrowserDialog *)lp);
 case WM_NCCALCSIZE:
  if(custom_window_frame){
   if(IsZoomed(hwnd)){
    RECT *client=wp?&((NCCALCSIZE_PARAMS *)lp)->rgrc[0]:(RECT *)lp;
    MONITORINFO monitor={sizeof(monitor)};
    if(GetMonitorInfoW(MonitorFromRect(client,MONITOR_DEFAULTTONEAREST),&monitor))
     IntersectRect(client,client,&monitor.rcWork);
   }
   return 0;
  }
  break;
 case WM_NCHITTEST:
  if(custom_window_frame)return frame_hit_test(hwnd,lp);
  break;
 case WM_SYSCOMMAND:
  if(wp==WINDOW_LICENSES){SendMessageW(hwnd,WM_COMMAND,900,0);return 0;}
  break;
 case WM_PAINT:{PAINTSTRUCT ps;HDC dc=BeginPaint(hwnd,&ps);double started=timing_now();draw();timing_log("layout and paint",started);if(pixels){BITMAPINFO bi={0};bi.bmiHeader=(BITMAPINFOHEADER){sizeof(BITMAPINFOHEADER),width,-height,1,32,BI_RGB,0,0,0,0,0};SetDIBitsToDevice(dc,0,0,width,height,0,0,0,height,pixels,&bi,DIB_RGB_COLORS);}EndPaint(hwnd,&ps);return 0;}
 case WM_SIZE:
  native_send_viewport(hwnd);
  InvalidateRect(hwnd,NULL,FALSE);return 0;
 case WM_ERASEBKGND:return 1;
 case WM_MOUSEWHEEL:{
  if(active_modal_node()&&modal_box_index()<0)return 0;
  POINT point={GET_X_LPARAM(lp),GET_Y_LPARAM(lp)};
  ScreenToClient(hwnd,&point);
  float delta=-60.0f*GET_WHEEL_DELTA_WPARAM(wp)/WHEEL_DELTA;
  if(!scroll_nested(point.x,point.y,delta)&&!active_modal_node())
   scroll=(int)fmaxf(0,fminf(scroll+delta,content_height-height));
  InvalidateRect(hwnd,NULL,FALSE);
  return 0;
 }
 case WM_VSCROLL:{if(active_modal_node())return 0;int action=LOWORD(wp);if(action==SB_THUMBTRACK||action==SB_THUMBPOSITION){SCROLLINFO si={sizeof(si),SIF_TRACKPOS};GetScrollInfo(hwnd,SB_VERT,&si);scroll=si.nTrackPos;}else scroll+=action==SB_LINEUP?-30:action==SB_LINEDOWN?30:action==SB_PAGEUP?-height/2:height/2;if(scroll<0)scroll=0;InvalidateRect(hwnd,NULL,FALSE);return 0;}
 case WM_KEYDOWN:
  if(wp==VK_ESCAPE&&request_overlay_dismiss())return 0;
  if(active_modal_node()&&modal_box_index()<0)return 0;
  if(wp!=VK_TAB&&scroll_region_key(wp,GetKeyState(VK_SHIFT)<0)){InvalidateRect(hwnd,NULL,FALSE);return 0;}
  if(window_key_default(wp)){key_consumed=true;return 0;}
  break;
 case WM_SETFOCUS:case WM_KILLFOCUS:InvalidateRect(hwnd,NULL,FALSE);break;
 case WM_MOUSEMOVE:{
  if(sheet_motion.dragging&&active_sheet_motion()){
   sheet_drag_to(&sheet_motion,GET_Y_LPARAM(lp),GetTickCount64());
   SetCursor(LoadCursorW(NULL,IDC_SIZENS));
   InvalidateRect(hwnd,NULL,FALSE);
   return 0;
  }
  int hovered=0;
  int floor=viewport_hit_floor(GET_X_LPARAM(lp),GET_Y_LPARAM(lp));
  for(int i=box_count-1;i>=floor;i--)if((boxes[i].kind==9||boxes[i].kind==10)&&in_box(&boxes[i],GET_X_LPARAM(lp),GET_Y_LPARAM(lp))){hovered=i+1;break;}
  if(hovered!=hovered_link){hovered_link=hovered;InvalidateRect(hwnd,NULL,FALSE);}
  bool hand=hovered!=0,track_leave=hovered!=0;
  if(native_interaction_styles()){
   pointer_inside=true;pointer_x=GET_X_LPARAM(lp);pointer_y=GET_Y_LPARAM(lp);track_leave=true;
   // Stylesheet cursor values are inherited, so the innermost box decides.
   if(boxes_current){
    int box=pointer_box(pointer_x,pointer_y);
    if(box>=0&&equal(snapshot,get(snapshot,style(boxes[box].node),"cursor"),"pointer"))hand=true;
   }
   update_pointer_target();
   native_send_interaction();
  }
  if(track_leave){
   TRACKMOUSEEVENT track={sizeof(track),TME_LEAVE,hwnd,0};
   TrackMouseEvent(&track);
  }
  if(hand)SetCursor(LoadCursorW(NULL,IDC_HAND));
  return 0;
 }
 case WM_MOUSELEAVE:
  hovered_link=0;
  {
   // Entering the native edit control also reports a leave. Keep the hover
   // chain while the pointer is over that child window.
   POINT point;
   if(!(editor&&GetCursorPos(&point)&&WindowFromPoint(point)==editor)){
    pointer_inside=false;update_pointer_target();native_send_interaction();
   }
  }
  InvalidateRect(hwnd,NULL,FALSE);return 0;
 case WM_CONTEXTMENU:{
  if((HWND)wp!=hwnd||lp==-1)break;
  POINT point={GET_X_LPARAM(lp),GET_Y_LPARAM(lp)},client=point;
  ScreenToClient(hwnd,&client);
  UpdateWindow(hwnd);
  int modal=modal_box_index();
  if(active_modal_node()&&(modal<0||!in_box(&boxes[modal],client.x,client.y)))return 0;
  int floor=viewport_hit_floor(client.x,client.y);
  for(int i=box_count-1;i>=floor;i--){
   struct Box box=boxes[i];
   if(!in_box(&box,client.x,client.y)||!box.node)continue;
   if(box.kind==2||box.kind==4){
    if(equal(snapshot,get(snapshot,box.props,"disabled"),"true"))return 0;
    if(!editor||box.native_id!=edit_native_id||wcscmp(box.public_id,edit_id))open_editor(&box);
    SendMessageW(editor,WM_CONTEXTMENU,(WPARAM)editor,lp);
    return 0;
   }
   if(get(snapshot,box.props,"contextMenu")){
    context_menu_event(box.node,client,NULL);
    return 0;
   }
  }
  break;
 }
 case WM_LBUTTONDOWN:{
  int x=GET_X_LPARAM(lp),y=GET_Y_LPARAM(lp);
  if(custom_window_frame&&y<chrome_height){
   struct Box *control=caption_control(x,y);
   if(!control)return 0;
   int node=find_identity(get(snapshot,1,"tree"),control->public_id,control->native_id);
   if(!node||equal(snapshot,get(snapshot,props(node),"disabled"),"true"))return 0;
   pressed_caption_command=caption_command(node);
   if(pressed_caption_command){pressed=*control;SetCapture(hwnd);}
   else activate(control);
   return 0;
  }
  key_focus=(struct Box){0};  // pointer input hides the keyboard focus ring
  int active=active_modal_node(),modal=modal_box_index();
  if(active&&modal<0)return 0;
  if(active&&y>=chrome_height&&!in_box(&boxes[modal],x,y)){request_overlay_dismiss();return 0;}
  int floor=viewport_hit_floor(x,y);
  scroll_focus=(struct Box){0};
  for(int i=box_count-1;i>=floor;i--){
   struct Box b=boxes[i];
   if(!in_box(&b,x,y))continue;
   if(active_sheet_motion()&&equal(snapshot,get(snapshot,b.props,"data-native-sheet-handle"),"true")){
    close_editor();SetFocus(hwnd);
    sheet_begin_drag(&sheet_motion,y,GetTickCount64());
    SetCapture(hwnd);InvalidateRect(hwnd,NULL,FALSE);
    return 0;
   }
   if(b.scroll_region&&get(snapshot,b.props,"tabIndex")){scroll_focus=b;break;}
   if(!((b.kind>=1&&b.kind<=4)||b.kind==9||b.kind==10||b.kind==12))continue;
   int live=find_identity(get(snapshot,1,"tree"),b.public_id,b.native_id);
   if(!live){InvalidateRect(hwnd,NULL,FALSE);return 0;}
   b.props=props(live);
   if((b.kind==1||b.kind==10)&&(active_scale(&b)!=1||active_opacity(&b)!=1)&&!equal(snapshot,get(snapshot,b.props,"disabled"),"true")){
    pressed=b;pointer_pressed=true;SetCapture(hwnd);InvalidateRect(hwnd,NULL,FALSE);
   }else{
    activate(&b);
    if((b.kind==2||b.kind==4)&&editor&&b.native_id==edit_native_id&&!wcscmp(b.public_id,edit_id)){
     POINT point={x,y};
     MapWindowPoints(hwnd,editor,&point,1);
     SendMessageW(editor,WM_LBUTTONDOWN,wp,MAKELPARAM(point.x,point.y));
    }
   }
   return 0;
  }
  close_editor();SetFocus(hwnd);InvalidateRect(hwnd,NULL,FALSE);return 0;
 }
 case WM_LBUTTONUP:
  if(pressed_caption_command){
   UINT command=pressed_caption_command;
   pressed_caption_command=0;
   ReleaseCapture();
   struct Box *control=caption_control(GET_X_LPARAM(lp),GET_Y_LPARAM(lp));
   if(control&&same_control(control,&pressed)){
    int node=find_identity(get(snapshot,1,"tree"),control->public_id,control->native_id);
    if(node&&command==caption_command(node)&&!equal(snapshot,get(snapshot,props(node),"disabled"),"true")){
     if(command==SC_MAXIMIZE&&IsZoomed(hwnd))command=SC_RESTORE;
     PostMessageW(hwnd,WM_SYSCOMMAND,command,0);
    }
   }
   return 0;
  }
  if(sheet_motion.dragging){
   bool dismiss=sheet_end_drag(&sheet_motion,GetTickCount64(),!active_sheet_motion(),document_reduce_motion);
   if(GetCapture()==hwnd)ReleaseCapture();
   if(dismiss)dismiss_active_modal();
   InvalidateRect(hwnd,NULL,FALSE);
   return 0;
  }
  if(pointer_pressed){
   pointer_pressed=false;ReleaseCapture();InvalidateRect(hwnd,NULL,FALSE);
   int floor=viewport_hit_floor(GET_X_LPARAM(lp),GET_Y_LPARAM(lp));
   for(int i=box_count-1;i>=floor;i--)if(same_control(&boxes[i],&pressed)&&in_box(&boxes[i],GET_X_LPARAM(lp),GET_Y_LPARAM(lp))){
    struct Box b=boxes[i];activate(&b);break;
   }
  }
  return 0;
 case WM_CAPTURECHANGED:
  pressed_caption_command=0;
  if(sheet_motion.dragging){sheet_end_drag(&sheet_motion,GetTickCount64(),true,document_reduce_motion);InvalidateRect(hwnd,NULL,FALSE);}
  if(pointer_pressed){pointer_pressed=false;InvalidateRect(hwnd,NULL,FALSE);}
  return 0;
 case WM_COMMAND:
  if(LOWORD(wp)==200&&HIWORD(wp)==EN_CHANGE&&!changing&&editor){
  int modal=active_modal_node();
  if(modal&&!find_identity(modal,edit_id,edit_native_id))return 0;
  wchar_t text[8192];editor_text(text);
  int n=find_identity(get(snapshot,1,"tree"),edit_id,edit_native_id);
  if(!n){
   close_editor();return 0;
  }
  if(get(snapshot,props(n),"change"))event(n,"change",text);
  return 0;
 }
  if(LOWORD(wp)>=1000&&LOWORD(wp)<1000+sizeof(routes)/sizeof(*routes)){navigate(routes[LOWORD(wp)-1000]);return 0;}
  if(LOWORD(wp)==900){HRSRC resource=FindResourceW(NULL,MAKEINTRESOURCEW(102),RT_RCDATA);if(resource){const char *text=LockResource(LoadResource(NULL,resource));DWORD size=SizeofResource(NULL,resource);wchar_t *wide=calloc(size+1,2);MultiByteToWideChar(CP_UTF8,0,text,size,wide,size);MessageBoxW(hwnd,wide,L"Native Skia and Porffor - third party notices",MB_OK);free(wide);}return 0;}break;
 case WM_CTLCOLOREDIT:{
  /* The native edit overlay matches the field it edits. A translucent
   * field background falls back to the default control fill. */
  int node=editor?find_identity(get(snapshot,1,"tree"),edit_id,edit_native_id):0;
  uint32_t fill=default_control_fill(editing?editing:2,false);
  uint32_t back=node?color(node,"backgroundColor",fill):fill;
  if((back>>24)!=255)back=fill;
  uint32_t ink=node?color(node,"color",document_light?0xff1f2328:0xfff3f5f8):0xfff3f5f8;
  COLORREF background=RGB((back>>16)&255,(back>>8)&255,back&255);
  static HBRUSH brush;static COLORREF brush_color=CLR_INVALID;
  if(!brush||brush_color!=background){if(brush)DeleteObject(brush);brush=CreateSolidBrush(background);brush_color=background;}
  SetTextColor((HDC)wp,RGB((ink>>16)&255,(ink>>8)&255,ink&255));SetBkColor((HDC)wp,background);
  return (LRESULT)brush;
 }
 case WM_TIMER:
  if(wp==1&&smoke){KillTimer(hwnd,1);smoke_test();return 0;}
  if(wp==2){
   if(active_sheet_motion()&&sheet_step(&sheet_motion,GetTickCount64()))dismiss_active_modal();
   InvalidateRect(hwnd,NULL,FALSE);
   return 0;
  }
  if(wp==CORE_TIMER){
   if(core_timer_delay_for(snapshot)==0){
    KillTimer(hwnd,CORE_TIMER);
    if(!native_busy&&!native_stopped&&!*native_status)native_enqueue(0,NULL,core_tick,NULL);
   }else arm_core_timer(hwnd);
   return 0;
  }
  break;
 case WM_CLOSE:close_editor();DestroyWindow(hwnd);return 0;
 case WM_DESTROY:
  broker_stop();
  native_stopped=true;
  native_clear_events();
  MSG pending;
  while(PeekMessageW(&pending,hwnd,REACTC_FRAME,REACTC_FRAME,PM_REMOVE))
   native_discard_frame((struct ReactcFrame *)pending.lParam);
  PostQuitMessage(0);return 0;
 }return DefWindowProcW(hwnd,message,wp,lp);
}
int WINAPI wWinMain(HINSTANCE instance,HINSTANCE previous,LPWSTR command,int show){
 smoke=!wcscmp(command,L"--smoke");
 if(*command&&!smoke)return 2;
 SetProcessDPIAware();snapshot=calloc(1,sizeof(*snapshot));reply=calloc(1,sizeof(*reply));if(!snapshot||!reply)fail("Cannot allocate native protocol buffers");
 job=CreateJobObjectW(NULL,NULL);JOBOBJECT_EXTENDED_LIMIT_INFORMATION limit={0};limit.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;if(!job||!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limit,sizeof(limit)))fail("Cannot create native application job");
 wchar_t temp[MAX_PATH];if(!GetTempPathW(MAX_PATH,temp))fail("Cannot locate temporary native library directory");swprintf(library_dir,MAX_PATH,L"%lsreactc-native-%lu-%llu",temp,GetCurrentProcessId(),GetTickCount64());if(!CreateDirectoryW(library_dir,NULL))fail("Cannot create private native library directory");swprintf(library_path,MAX_PATH,L"%ls\\libSkiaSharp.dll",library_dir);
 HRSRC resource=FindResourceW(NULL,MAKEINTRESOURCEW(101),RT_RCDATA);if(!resource)fail("Native Skia resource missing");DWORD size=SizeofResource(NULL,resource),written;HANDLE file=CreateFileW(library_path,GENERIC_WRITE,0,NULL,CREATE_NEW,FILE_ATTRIBUTE_NORMAL,NULL);if(file==INVALID_HANDLE_VALUE||!WriteFile(file,LockResource(LoadResource(NULL,resource)),size,&written,NULL)||written!=size)fail("Cannot unpack embedded native Skia");CloseHandle(file);
 skia=LoadLibraryExW(library_path,NULL,LOAD_LIBRARY_SEARCH_DLL_LOAD_DIR|LOAD_LIBRARY_SEARCH_SYSTEM32);if(!skia)fail("Windows could not load embedded native Skia");load_skia(skia);
 paint=sk_paint_new();sk_paint_set_antialias(paint,true);void *font_style=sk_fontstyle_new(400,5,0);face=sk_typeface_create_from_name("Segoe UI",font_style);sk_fontstyle_delete(font_style);font=sk_font_new_with_values(face,16,1,0);if(!font||!paint)fail("Cannot create native Skia text resources");
 edit_font=CreateFontW(-16,0,0,0,FW_NORMAL,FALSE,FALSE,FALSE,DEFAULT_CHARSET,0,0,CLEARTYPE_QUALITY,0,L"Segoe UI");
 WNDCLASSW cls={0};cls.style=custom_window_frame?CS_DBLCLKS:0;cls.lpfnWndProc=procedure;cls.hInstance=instance;cls.lpszClassName=L"PTPorfforSkiaNative";cls.hCursor=LoadCursor(NULL,IDC_ARROW);if(!RegisterClassW(&cls))fail("Cannot register Windows app class");
 DWORD window_style=WS_OVERLAPPEDWINDOW|(custom_window_frame?0:WS_VSCROLL);
 window=CreateWindowExW(0,cls.lpszClassName,APP_TITLE,window_style,CW_USEDEFAULT,CW_USEDEFAULT,470,900,NULL,NULL,instance,NULL);if(!window)fail("Cannot create native Windows window");
 if(custom_window_frame){
  HMENU system_menu=GetSystemMenu(window,FALSE);
  AppendMenuW(system_menu,MF_SEPARATOR,0,NULL);
  AppendMenuW(system_menu,MF_STRING,WINDOW_LICENSES,L"Licenses");
 }else{
 HMENU menu=CreateMenu();
 AppendMenuW(menu,MF_STRING,900,L"Licenses");SetMenu(window,menu);
 }
 core_start();
 broker_start(window);
 ShowWindow(window,show);UpdateWindow(window);
 MSG msg;while(GetMessageW(&msg,NULL,0,0)>0){
  if(native_report_key(&msg))continue;
  if(msg.message==WM_KEYDOWN&&msg.wParam==VK_ESCAPE&&msg.hwnd==editor&&request_overlay_dismiss())continue;
  if((msg.message==WM_KEYDOWN||msg.message==WM_SYSKEYDOWN)&&msg.wParam==VK_RETURN&&
     editor_enter(&msg,GetKeyState(VK_SHIFT)<0,GetKeyState(VK_CONTROL)<0,GetKeyState(VK_MENU)<0,
      GetKeyState(VK_LWIN)<0||GetKeyState(VK_RWIN)<0,(msg.lParam&(1L<<30))!=0))continue;
  TranslateMessage(&msg);DispatchMessageW(&msg);
 }cleanup();DeleteObject(edit_font);free(pixels);free(snapshot);free(reply);return (int)msg.wParam;
}
