package art.wingwu.panelforge;

import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.util.List;

/**
 * 「用某个绘画 App 打开这一格」。
 *
 * 系统分享面板（Capacitor Share）已经能把图交给任意 App，但它有两个问题：
 *   1. 用户每次都要在长列表里翻；
 *   2. 我们没法知道目标 App 到底接不接收图片。
 * 所以这里直接问 PackageManager：
 *   - listTargets()：列出**真的会出现在分享面板里**的 App（ACTION_SEND + image/*）
 *   - sendTo(pkg)：用 setPackage() 直接跳到指定 App，跳过面板
 *
 * 注意：只有目标 App 自己声明了接收图片的 intent-filter，才可能直跳；
 * 它没声明的话，任何方案都跳不过去（那不是我们能绕过的限制）。
 */
@CapacitorPlugin(name = "ShareTo")
public class ShareToPlugin extends Plugin {

    /** 当前这台手机上，能把图片分享过去的所有 App */
    @PluginMethod
    public void listTargets(PluginCall call) {
        try {
            PackageManager pm = getContext().getPackageManager();
            Intent probe = new Intent(Intent.ACTION_SEND).setType("image/*");
            List<ResolveInfo> list = pm.queryIntentActivities(probe, PackageManager.MATCH_DEFAULT_ONLY);
            JSArray arr = new JSArray();
            String self = getContext().getPackageName();
            for (ResolveInfo ri : list) {
                if (ri.activityInfo == null) continue;
                String pkg = ri.activityInfo.packageName;
                if (self.equals(pkg)) continue;   // 别把自己列进去
                JSObject o = new JSObject();
                o.put("package", pkg);
                o.put("label", String.valueOf(ri.loadLabel(pm)));
                arr.put(o);
            }
            JSObject ret = new JSObject();
            ret.put("targets", arr);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("列出分享目标失败：" + e.getMessage());
        }
    }

    /**
     * 直接把图片交给指定包名的 App（跳过系统面板）。
     * uri 支持 file:// 与 content://；file:// 会自动转成 FileProvider 的 content://
     * 并授予读权限，否则目标 App 拿到的是个读不了的地址。
     */
    @PluginMethod
    public void sendTo(PluginCall call) {
        String pkg = call.getString("package");
        String uriStr = call.getString("uri");
        String mime = call.getString("mime", "image/png");
        if (pkg == null || uriStr == null) {
            call.reject("缺少 package 或 uri");
            return;
        }
        try {
            Uri uri = Uri.parse(uriStr);
            if ("file".equals(uri.getScheme()) || uri.getScheme() == null) {
                File f = new File(uri.getPath());
                uri = FileProvider.getUriForFile(getContext(),
                    getContext().getPackageName() + ".fileprovider", f);
            }
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType(mime);
            i.putExtra(Intent.EXTRA_STREAM, uri);
            i.setPackage(pkg);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            if (getActivity() != null) {
                getActivity().startActivity(Intent.createChooser(i, null).setPackage(pkg));
            } else {
                getContext().startActivity(i);
            }
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("直跳失败（该 App 可能不接受图片分享）：" + e.getMessage());
        }
    }
}
