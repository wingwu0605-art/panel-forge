package art.wingwu.panelforge;

import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 把图存进系统相册（MediaStore）。
 *
 * 为什么需要它：Android WebView **不支持** 网页里那套 `<a download href="blob:...">`，
 * 所以网页版的「导出」在壳里点了没反应。这个插件把 base64 直接写进
 * Pictures/PanelForge/，走 MediaStore 所以相册里立刻能看到，也不用申请存储权限。
 */
@CapacitorPlugin(name = "SaveImage")
public class SaveImagePlugin extends Plugin {

    @PluginMethod
    public void save(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("缺少图片数据");
            return;
        }
        String name = call.getString("name", "panelforge.png");
        String mime = call.getString("mime", "image/png");
        byte[] bytes;
        try {
            // 允许前端传 dataURL 前缀，也允许纯 base64
            int comma = data.indexOf(',');
            if (data.startsWith("data:") && comma > 0) data = data.substring(comma + 1);
            bytes = Base64.decode(data, Base64.DEFAULT);
        } catch (Exception e) {
            call.reject("图片数据解析失败：" + e.getMessage());
            return;
        }

        try {
            JSObject ret = new JSObject();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, name);
                v.put(MediaStore.Images.Media.MIME_TYPE, mime);
                v.put(MediaStore.Images.Media.RELATIVE_PATH,
                    Environment.DIRECTORY_PICTURES + "/PanelForge");
                v.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = getContext().getContentResolver()
                    .insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) { call.reject("相册写入失败（拿不到 URI）"); return; }
                try (OutputStream out = getContext().getContentResolver().openOutputStream(uri)) {
                    if (out == null) { call.reject("相册写入失败（打不开输出流）"); return; }
                    out.write(bytes);
                }
                v.clear();
                v.put(MediaStore.Images.Media.IS_PENDING, 0);
                getContext().getContentResolver().update(uri, v, null, null);
                ret.put("uri", uri.toString());
                ret.put("path", "Pictures/PanelForge/" + name);
            } else {
                // Android 10 以下：写应用外部目录（不需要权限，但要去相册里手动刷新）
                File dir = new File(Environment.getExternalStoragePublicDirectory(
                    Environment.DIRECTORY_PICTURES), "PanelForge");
                if (!dir.exists() && !dir.mkdirs()) { call.reject("建目录失败"); return; }
                File f = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(f)) { out.write(bytes); }
                ret.put("path", f.getAbsolutePath());
            }
            ret.put("bytes", bytes.length);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("保存失败：" + e.getMessage());
        }
    }
}
