package com.pwbook.ui.components

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pwbook.crypto.TotpGenerator
import kotlinx.coroutines.delay

@Composable
fun TotpDisplay(
    secret: String,
    period: Int = 30,
    digits: Int = 6,
    algorithm: String = "SHA1",
    modifier: Modifier = Modifier
) {
    val (actualSecret, actualAlgorithm, actualDigits, actualPeriod) = remember(secret) {
        parseOtpauthUri(secret, algorithm, digits, period)
    }

    var code by remember { mutableStateOf(TotpGenerator.generate(actualSecret, actualPeriod, actualDigits, actualAlgorithm)) }
    var remaining by remember { mutableIntStateOf(TotpGenerator.remainingSeconds(actualPeriod)) }

    LaunchedEffect(secret) {
        while (true) {
            code = TotpGenerator.generate(actualSecret, actualPeriod, actualDigits, actualAlgorithm)
            remaining = TotpGenerator.remainingSeconds(actualPeriod)
            delay(1000)
        }
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = modifier
    ) {
        Text(
            text = code,
            fontSize = 28.sp,
            fontFamily = FontFamily.Monospace,
            color = MaterialTheme.colorScheme.primary
        )
        CircularCountdown(
            remaining = remaining,
            period = period,
            modifier = Modifier.size(32.dp)
        )
    }
}

private fun parseOtpauthUri(
    input: String,
    defaultAlgorithm: String,
    defaultDigits: Int,
    defaultPeriod: Int
): TotpParams {
    if (!input.startsWith("otpauth://totp/")) {
        return TotpParams(input, defaultAlgorithm, defaultDigits, defaultPeriod)
    }
    val query = input.substringAfter("?", "")
    val params = query.split("&").associate { pair ->
        val parts = pair.split("=", limit = 2)
        parts[0] to (parts.getOrNull(1)?.let { java.net.URLDecoder.decode(it, "UTF-8") } ?: "")
    }
    val secret = params["secret"] ?: input
    val algorithm = params["algorithm"] ?: defaultAlgorithm
    val digits = params["digits"]?.toIntOrNull() ?: defaultDigits
    val period = params["period"]?.toIntOrNull() ?: defaultPeriod
    return TotpParams(secret, algorithm, digits, period)
}

private data class TotpParams(
    val secret: String,
    val algorithm: String,
    val digits: Int,
    val period: Int
)

@Composable
private fun CircularCountdown(
    remaining: Int,
    period: Int,
    modifier: Modifier = Modifier
) {
    val progress = remaining.toFloat() / period.toFloat()
    val animatedProgress by animateFloatAsState(
        targetValue = progress,
        animationSpec = tween(durationMillis = 1000),
        label = "countdown"
    )
    val color = when {
        progress > 0.5f -> MaterialTheme.colorScheme.primary
        progress > 0.2f -> MaterialTheme.colorScheme.secondary
        else -> MaterialTheme.colorScheme.error
    }

    Box(modifier = modifier, contentAlignment = Alignment.Center) {
        Canvas(modifier = Modifier.size(32.dp)) {
            drawArc(
                color = color.copy(alpha = 0.2f),
                startAngle = -90f,
                sweepAngle = 360f,
                useCenter = false,
                style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round)
            )
            drawArc(
                color = color,
                startAngle = -90f,
                sweepAngle = 360f * animatedProgress,
                useCenter = false,
                style = Stroke(width = 4.dp.toPx(), cap = StrokeCap.Round)
            )
        }
        Text(
            text = remaining.toString(),
            fontSize = 12.sp,
            color = color
        )
    }
}
