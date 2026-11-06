package expo.modules.systeminsets

import android.os.Build
import android.view.WindowInsets
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Reports the space taken by the status bar, navigation bar and display cutout,
// in density-independent pixels, so the edge-to-edge UI can pad around them.
// Replaces react-native-safe-area-context, whose generated C++ paths are too
// long for Android's bundled build tools on Windows.
class SystemInsetsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SystemInsets")

    AsyncFunction("get") {
      val view = appContext.currentActivity?.window?.decorView
      val insets = view?.rootWindowInsets
      val density = (view?.resources?.displayMetrics?.density ?: 1f).toDouble()

      if (insets == null) {
        return@AsyncFunction mapOf("top" to 0.0, "bottom" to 0.0, "left" to 0.0, "right" to 0.0)
      }

      val sides: List<Int> = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val i = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
        listOf(i.top, i.bottom, i.left, i.right)
      } else {
        @Suppress("DEPRECATION")
        listOf(insets.systemWindowInsetTop, insets.systemWindowInsetBottom, insets.systemWindowInsetLeft, insets.systemWindowInsetRight)
      }

      mapOf(
        "top" to sides[0] / density,
        "bottom" to sides[1] / density,
        "left" to sides[2] / density,
        "right" to sides[3] / density,
      )
    }.runOnQueue(Queues.MAIN)
  }
}
