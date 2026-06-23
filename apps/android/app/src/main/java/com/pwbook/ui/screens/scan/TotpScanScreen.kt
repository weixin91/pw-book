package com.pwbook.ui.screens.scan

import android.Manifest
import android.content.pm.PackageManager
import android.util.Size
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.LocalLifecycleOwner
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.common.HybridBinarizer
import timber.log.Timber

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TotpScanScreen(
    onBack: () -> Unit,
    onTotpScanned: (otpauthUri: String) -> Unit
) {
    val context = LocalContext.current
    val lifecycleOwner = LocalLifecycleOwner.current
    var hasCameraPermission by remember {
        mutableStateOf(
            ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        )
    }
    var scannedCode by remember { mutableStateOf<String?>(null) }

    val launcher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasCameraPermission = granted
    }

    LaunchedEffect(Unit) {
        if (!hasCameraPermission) {
            launcher.launch(Manifest.permission.CAMERA)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("扫描 TOTP 二维码") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回")
                    }
                }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (hasCameraPermission) {
                AndroidView(
                    modifier = Modifier.fillMaxSize(),
                    factory = { ctx ->
                        val previewView = androidx.camera.view.PreviewView(ctx)
                        val cameraProviderFuture = ProcessCameraProvider.getInstance(ctx)
                        cameraProviderFuture.addListener({
                            val cameraProvider = cameraProviderFuture.get()
                            val preview = Preview.Builder()
                                .build()
                                .also { it.surfaceProvider = previewView.surfaceProvider }

                            val resolutionSelector = ResolutionSelector.Builder()
                                .setResolutionStrategy(
                                    ResolutionStrategy(
                                        Size(1280, 720),
                                        ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                                    )
                                )
                                .build()

                            val imageAnalysis = ImageAnalysis.Builder()
                                .setResolutionSelector(resolutionSelector)
                                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                                .build()

                            imageAnalysis.setAnalyzer(
                                ContextCompat.getMainExecutor(ctx)
                            ) { imageProxy ->
                                val yPlane = imageProxy.planes[0]
                                val buffer = yPlane.buffer
                                val rowStride = yPlane.rowStride
                                val pixelStride = yPlane.pixelStride
                                val width = imageProxy.width
                                val height = imageProxy.height

                                // 正确提取 Y 平面数据，处理 rowStride 填充
                                val bytes = if (pixelStride == 1 && rowStride == width) {
                                    ByteArray(buffer.remaining()).also { buffer.get(it) }
                                } else {
                                    val data = ByteArray(width * height)
                                    val row = ByteArray(rowStride)
                                    for (y in 0 until height) {
                                        buffer.position(y * rowStride)
                                        val len = minOf(rowStride, buffer.remaining())
                                        buffer.get(row, 0, len)
                                        System.arraycopy(row, 0, data, y * width, minOf(width, len))
                                    }
                                    data
                                }

                                val source = PlanarYUVLuminanceSource(
                                    bytes,
                                    width,
                                    height,
                                    0, 0,
                                    width,
                                    height,
                                    false
                                )
                                val bitmap = BinaryBitmap(HybridBinarizer(source))
                                try {
                                    val result = MultiFormatReader().decode(bitmap)
                                    val text = result.text
                                    if (text != null && text != scannedCode) {
                                        scannedCode = text
                                        Timber.i("QR code scanned: $text")
                                        val parsed = parseOtpauthUri(text)
                                        if (parsed != null) {
                                            onTotpScanned(text)
                                        } else {
                                            Timber.w("非 TOTP 二维码: ${text.take(80)}")
                                            android.widget.Toast.makeText(
                                                ctx,
                                                "不是有效的 TOTP 二维码",
                                                android.widget.Toast.LENGTH_SHORT
                                            ).show()
                                        }
                                    }
                                } catch (_: Exception) {
                                    // 无二维码或解码失败，忽略
                                } finally {
                                    imageProxy.close()
                                }
                            }

                            val cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
                            try {
                                cameraProvider.unbindAll()
                                cameraProvider.bindToLifecycle(
                                    lifecycleOwner,
                                    cameraSelector,
                                    preview,
                                    imageAnalysis
                                )
                            } catch (e: Exception) {
                                Timber.e(e, "Camera binding failed")
                            }
                        }, ContextCompat.getMainExecutor(ctx))
                        previewView
                    }
                )
                Text(
                    text = "将二维码对准取景框",
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 32.dp)
                )
            } else {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .align(Alignment.Center)
                        .padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("需要相机权限来扫描二维码")
                    Spacer(modifier = Modifier.height(16.dp))
                    androidx.compose.material3.Button(
                        onClick = { launcher.launch(Manifest.permission.CAMERA) }
                    ) {
                        Text("授予权限")
                    }
                }
            }
        }
    }
}

private data class OtpauthParseResult(
    val secret: String,
    val account: String?,
    val issuer: String?
)

private fun parseOtpauthUri(uri: String): OtpauthParseResult? {
    val lower = uri.lowercase()
    // 支持 otpauth://totp/ 和 otpauth://hotp/ 两种 scheme
    val isTotp = lower.startsWith("otpauth://totp/")
    val isHotp = lower.startsWith("otpauth://hotp/")
    if (!isTotp && !isHotp) return null
    val path = uri.substringAfter("otpauth://").substringAfter("/").substringBefore("?")
    val account = path.decodeUrl()
    val query = uri.substringAfter("?", "")
    if (query.isEmpty()) return null
    val params = mutableMapOf<String, String>()
    for (pair in query.split("&")) {
        val eqIdx = pair.indexOf("=")
        if (eqIdx < 0) continue
        val key = pair.substring(0, eqIdx).lowercase()
        val value = pair.substring(eqIdx + 1).decodeUrl()
        params[key] = value
    }
    val secret = params["secret"] ?: return null
    // 校验 Base32 格式（RFC 4648），防止无效密钥入库
    if (!secret.matches(Regex("^[A-Za-z2-7]+=*$"))) {
        Timber.w("非法的 Base32 secret: ${secret.take(20)}")
        return null
    }
    val issuer = params["issuer"]
    return OtpauthParseResult(secret, account, issuer)
}

private fun String.decodeUrl(): String {
    return java.net.URLDecoder.decode(this, "UTF-8")
}
