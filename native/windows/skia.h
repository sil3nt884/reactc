/* Native C ABI declarations from mono/skia include/c at
 * 927041a58f130e0dd0562ba86cb4170989ad39e9 (SkiaSharp 3.119.2).
 * No managed SkiaSharp assembly or .NET runtime is used.
 */
#include <stdbool.h>
#include <stdint.h>
typedef struct {void *colorspace;int32_t width,height;int colorType,alphaType;} SkInfo;
typedef struct {float left,top,right,bottom;} SkRect;
typedef struct {float x,y;} SkVector;
typedef struct {SkRect *bounds;void *paint,*backdrop;int flags;} SkLayerRec;
#define API(ret,name,args) static ret (*name) args
API(void*,sk_surface_new_raster_direct,(const SkInfo*,void*,size_t,void*,void*,void*));
API(void,sk_surface_unref,(void*));
API(void*,sk_surface_get_canvas,(void*));
API(void,sk_canvas_clear,(void*,uint32_t));
API(void,sk_canvas_draw_round_rect,(void*,const SkRect*,float,float,void*));
API(void,sk_canvas_draw_rrect,(void*,const void*,const void*));
API(void,sk_canvas_draw_line,(void*,float,float,float,float,void*));
API(void,sk_canvas_draw_path,(void*,const void*,const void*));
API(void,sk_canvas_draw_circle,(void*,float,float,float,const void*));
API(int,sk_canvas_save,(void*));
API(int,sk_canvas_save_layer,(void*,const SkRect*,const void*));
API(int,sk_canvas_save_layer_rec,(void*,const SkLayerRec*));
API(void,sk_canvas_restore,(void*));
API(void,sk_canvas_translate,(void*,float,float));
API(void,sk_canvas_scale,(void*,float,float));
API(void,sk_canvas_rotate_degrees,(void*,float));
API(void,sk_canvas_clip_rect_with_operation,(void*,const SkRect*,int,bool));
API(void,sk_canvas_clip_path_with_operation,(void*,const void*,int,bool));
API(void,sk_canvas_clip_rrect_with_operation,(void*,const void*,int,bool));
API(void*,sk_path_new,(void));
API(void,sk_path_delete,(void*));
API(bool,sk_path_parse_svg_string,(void*,const char*));
API(void,sk_path_add_rounded_rect,(void*,const SkRect*,float,float,int));
API(void*,sk_rrect_new,(void));
API(void,sk_rrect_delete,(const void*));
API(void,sk_rrect_set_rect_radii,(void*,const SkRect*,const SkVector*));
API(void,sk_canvas_draw_simple_text,(void*,const void*,size_t,int,float,float,void*,void*));
API(void*,sk_paint_new,(void));
API(void,sk_paint_delete,(void*));
API(void,sk_paint_set_color,(void*,uint32_t));
API(void,sk_paint_set_antialias,(void*,bool));
API(void,sk_paint_set_stroke_width,(void*,float));
API(void,sk_paint_set_style,(void*,int));
API(void,sk_paint_set_stroke_cap,(void*,int));
API(void,sk_paint_set_stroke_join,(void*,int));
API(void,sk_paint_set_path_effect,(void*,void*));
API(void*,sk_path_effect_create_dash,(const float*,int,float));
API(void,sk_path_effect_unref,(void*));
API(void*,sk_imagefilter_new_blur,(float,float,int,const void*,const SkRect*));
API(void,sk_imagefilter_unref,(void*));
API(void*,sk_font_new_with_values,(void*,float,float,float));
API(void,sk_font_delete,(void*));
API(void,sk_font_set_size,(void*,float));
API(float,sk_font_measure_text,(void*,const void*,size_t,int,void*,void*));
API(void*,sk_fontstyle_new,(int,int,int));
API(void,sk_fontstyle_delete,(void*));
API(void*,sk_typeface_create_from_name,(const char*,void*));
API(void,sk_typeface_unref,(void*));
API(uint16_t,sk_font_unichar_to_glyph,(const void*,int32_t));
API(void*,sk_fontmgr_ref_default,(void));
API(void*,sk_fontmgr_match_family_style_character,(void*,const char*,void*,const char**,int,int32_t));
#undef API
static void load_skia(HMODULE library){
#define LOAD(name) name=(void*)GetProcAddress(library,#name);if(!name)fail("Missing native Skia API: " #name)
 LOAD(sk_surface_new_raster_direct);LOAD(sk_surface_unref);LOAD(sk_surface_get_canvas);LOAD(sk_canvas_clear);
 LOAD(sk_canvas_draw_round_rect);LOAD(sk_canvas_draw_line);LOAD(sk_canvas_draw_simple_text);
 LOAD(sk_canvas_draw_rrect);LOAD(sk_rrect_new);LOAD(sk_rrect_delete);LOAD(sk_rrect_set_rect_radii);
 LOAD(sk_canvas_draw_path);LOAD(sk_canvas_draw_circle);LOAD(sk_canvas_save);LOAD(sk_canvas_save_layer);LOAD(sk_canvas_restore);
 LOAD(sk_canvas_save_layer_rec);LOAD(sk_imagefilter_new_blur);LOAD(sk_imagefilter_unref);
 LOAD(sk_canvas_translate);LOAD(sk_canvas_scale);LOAD(sk_canvas_rotate_degrees);LOAD(sk_canvas_clip_rect_with_operation);
 LOAD(sk_canvas_clip_path_with_operation);LOAD(sk_canvas_clip_rrect_with_operation);
 LOAD(sk_path_new);LOAD(sk_path_delete);LOAD(sk_path_parse_svg_string);LOAD(sk_path_add_rounded_rect);
 LOAD(sk_paint_new);LOAD(sk_paint_delete);LOAD(sk_paint_set_color);LOAD(sk_paint_set_antialias);LOAD(sk_paint_set_stroke_width);
 LOAD(sk_paint_set_style);LOAD(sk_paint_set_stroke_cap);LOAD(sk_paint_set_stroke_join);
 LOAD(sk_paint_set_path_effect);LOAD(sk_path_effect_create_dash);LOAD(sk_path_effect_unref);
 LOAD(sk_font_new_with_values);LOAD(sk_font_delete);LOAD(sk_font_set_size);LOAD(sk_font_measure_text);LOAD(sk_fontstyle_new);LOAD(sk_fontstyle_delete);LOAD(sk_typeface_create_from_name);LOAD(sk_typeface_unref);
 LOAD(sk_font_unichar_to_glyph);LOAD(sk_fontmgr_ref_default);LOAD(sk_fontmgr_match_family_style_character);
#undef LOAD
}
