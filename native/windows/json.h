/* Small bounded JSON DOM for the native host protocol. This parses data only. */
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <wchar.h>
#include <ctype.h>
#define JSON_BYTES (2*1024*1024)
#define JSON_TOKENS 65536
struct Token {int start,end,next,type;};
struct Json {char text[JSON_BYTES];struct Token t[JSON_TOKENS];int count,pos;};
static void fail(const char *message);
static void space(struct Json *d){while(d->text[d->pos]&&isspace((unsigned char)d->text[d->pos]))d->pos++;}
static int value(struct Json *d,int depth){
 space(d);if(depth>100||d->count>=JSON_TOKENS)fail("JSON protocol exceeds parser limits");
 int i=++d->count;if(i>=JSON_TOKENS)fail("Too many protocol tokens");
 struct Token *t=&d->t[i];t->start=d->pos;char c=d->text[d->pos++];t->type=c;
 if(c=='{'||c=='['){
  space(d);char end=c=='{'?'}':']';
  if(d->text[d->pos]!=end)for(;;){
   if(c=='{'){space(d);if(d->text[d->pos]!='"')fail("Invalid JSON object key");value(d,depth+1);space(d);if(d->text[d->pos++]!=':')fail("Missing JSON colon");}
   value(d,depth+1);space(d);if(d->text[d->pos]!=',')break;d->pos++;
  }
  if(d->text[d->pos++]!=end)fail("Invalid JSON container");
 }else if(c=='"'){
  while(d->text[d->pos]&&d->text[d->pos]!='"'){
   if((unsigned char)d->text[d->pos]<32)fail("Invalid JSON string");
   if(d->text[d->pos++]=='\\'){char escape=d->text[d->pos++];if(!escape)fail("Invalid JSON escape");if(escape=='u')for(int n=0;n<4;n++)if(!isxdigit((unsigned char)d->text[d->pos++]))fail("Invalid Unicode escape");}
  }
  if(d->text[d->pos++]!='"')fail("Unterminated JSON string");
 }else{
  while(d->text[d->pos]&&!strchr(",}] \t\r\n",d->text[d->pos]))d->pos++;
  if(!strchr("-0123456789tfn",c))fail("Invalid JSON scalar");
 }
 t->end=d->pos;t->next=d->count+1;return i;
}
static void parse(struct Json *d){d->count=d->pos=0;value(d,0);space(d);if(d->text[d->pos])fail("Trailing protocol data");}
static int equal(struct Json *d,int t,const char *s){if(!t)return 0;struct Token v=d->t[t];if(v.type=='"'){v.start++;v.end--;}return v.end-v.start==(int)strlen(s)&&!memcmp(d->text+v.start,s,strlen(s));}
static int get(struct Json *d,int obj,const char *key){if(!obj||d->t[obj].type!='{')return 0;for(int k=obj+1;k<d->t[obj].next;){int v=k+1;if(equal(d,k,key))return v;k=d->t[v].next;}return 0;}
static double number(struct Json *d,int t,double fallback){return t&&strchr("-0123456789",d->t[t].type)?atof(d->text+d->t[t].start):fallback;}
static void raw(struct Json *d,int t,char *out,size_t cap){if(!t){snprintf(out,cap,"null");return;}size_t len=d->t[t].end-d->t[t].start;if(len>=cap)fail("JSON value exceeds buffer");memcpy(out,d->text+d->t[t].start,len);out[len]=0;}
static size_t string(struct Json *d,int t,wchar_t *out,size_t cap){
 if(!t||d->t[t].type!='"'){*out=0;return 0;}size_t n=0;int p=d->t[t].start+1,end=d->t[t].end-1;
 while(p<end&&n+1<cap){unsigned char c=d->text[p++];
  if(c=='\\'){c=d->text[p++];if(c=='u'){unsigned v=0;for(int k=0;k<4;k++){char x=d->text[p++];v=v*16+(x<='9'?x-'0':tolower(x)-'a'+10);}out[n++]=(wchar_t)v;}else out[n++]=c=='n'?'\n':c=='r'?'\r':c=='t'?'\t':c=='b'?'\b':c=='f'?'\f':c;
  }else if(c<128)out[n++]=c;
  else{int len=c<0xe0?2:c<0xf0?3:4;int units=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,d->text+p-1,len,out+n,(int)(cap-n-1));if(!units)fail("Invalid UTF-8 in snapshot");n+=units;p+=len-1;}
 }if(p<end)fail("Display text exceeds capacity");out[n]=0;return n;
}
static void quote_units(const wchar_t *in,size_t length,char *out,size_t cap){size_t n=0;out[n++]='"';for(size_t i=0;i<length;i++){unsigned c=in[i];if(n+8>=cap)fail("Input exceeds protocol limit");if(c<32||c>126){snprintf(out+n,7,"\\u%04x",c);n+=6;}else{if(c=='"'||c=='\\')out[n++]='\\';out[n++]=(char)c;}}out[n++]='"';out[n]=0;}

static void quote(const wchar_t *in,char *out,size_t cap){quote_units(in,wcslen(in),out,cap);}
