package art.wingwu.panelforge;

import android.net.Uri;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * 接收其它 App 分享过来的图片（ACTION_SEND image/*）。
 *
 * 为什么不用现成插件：Capacitor 只有「分享出去」的官方插件，没有「收进来」的。
 * 这个插件做两件事：
 *   1. MainActivity 在 onNewIntent 里把 content:// URI 交给这里暂存
 *   2. 前端调用 getPending() 时，把图片读成 base64 返回（content:// 在 WebView 里 fetch 不了）
 *
 * 拿到 base64 后前端自己转 Blob，走和「选图片填入此格」完全相同的入库流程。
 */
@CapacitorPlugin(name = "ShareTarget")
public class ShareTargetPlugin extends Plugin {

    private static Uri pendingUri = null;

    /** 由 MainActivity 在收到分享时调用 */
    public static void setPending(Uri uri) {
        pendingUri = uri;
    }

    /**
     * 取走暂存的分享图。返回 null = 没有待处理的分享。
     * base64 + mime 交给前端拼 Blob。
     */
    @PluginMethod
    public void getPending(PluginCall call) {
        Uri uri = pendingUri;
        if (uri == null) {
            call.resolve();
            return;
        }
        pendingUri = null;   // 只消费一次，避免重复填入
        try (InputStream in = getContext().getContentResolver().openInputStream(uri)) {
            if (in == null) {
                call.reject("读不到分享的图片");
                return;
            }
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] chunk = new byte[8192];
            int n;
            while ((n = in.read(chunk)) > 0) buf.write(chunk, 0, n);
            String mime = getContext().getContentResolver().getType(uri);
            JSObject ret = new JSObject();
            ret.put("data", Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP));
            ret.put("mime", mime == null ? "image/png" : mime);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读分享图片失败：" + e.getMessage(), e);
        }
    }

    /** 前端处理完（或用户忽略）时清掉，避免下次启动又被填一次 */
    @PluginMethod
    public void clear(PluginCall call) {
        pendingUri = null;
        call.resolve();
    }
}
