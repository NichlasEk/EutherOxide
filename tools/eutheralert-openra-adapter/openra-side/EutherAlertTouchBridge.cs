#region Copyright & License Information
/*
 * Copyright (c) EutherOxide contributors
 * This OpenRA-side adapter is intended to be compiled with OpenRA and is
 * therefore made available under the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or (at your
 * option) any later version.
 */
#endregion

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace OpenRA.EutherAlert
{
	public sealed class EutherAlertTouchEvent
	{
		public ulong Id { get; set; }
		[JsonPropertyName("unix_ms")]
		public ulong UnixMs { get; set; }
		public string Instance { get; set; }
		public string Client { get; set; }
		public int Player { get; set; }
		public string Kind { get; set; }
		public Dictionary<string, JsonElement> Payload { get; set; }
	}

	public static class EutherAlertTouchBridge
	{
		static EutherAlertInputHandler inputHandler;

		public static IInputHandler Wrap(IInputHandler inner)
		{
			var path = Environment.GetEnvironmentVariable("EUTHERALERT_TOUCH_BRIDGE_FILE");
			if (string.IsNullOrWhiteSpace(path))
				return inner;

			inputHandler ??= new EutherAlertInputHandler(inner, path);
			inputHandler.Inner = inner;
			inputHandler.DrainTouchEvents();
			return inputHandler;
		}

		public static EutherAlertTouchEvent ParseJsonLine(string line)
		{
			if (string.IsNullOrWhiteSpace(line))
				return null;

			return JsonSerializer.Deserialize<EutherAlertTouchEvent>(line, new JsonSerializerOptions
			{
				PropertyNameCaseInsensitive = true
			});
		}
	}

	public sealed class EutherAlertInputHandler : IInputHandler, IDisposable
	{
		readonly string path;
		readonly string applyLogPath;
		FileStream stream;
		StreamReader reader;
		long offset;
		int2 lastPos = int2.Zero;
		bool leftDown;

		public IInputHandler Inner { get; set; }

		public EutherAlertInputHandler(IInputHandler inner, string path)
		{
			Inner = inner;
			this.path = path;
			applyLogPath = Environment.GetEnvironmentVariable("EUTHERALERT_TOUCH_BRIDGE_APPLY_LOG");
		}

		public void ModifierKeys(Modifiers mods)
		{
			DrainTouchEvents();
			Inner.ModifierKeys(mods);
		}

		public void OnKeyInput(KeyInput input)
		{
			DrainTouchEvents();
			Inner.OnKeyInput(input);
		}

		public void OnMouseInput(MouseInput input)
		{
			DrainTouchEvents();
			Inner.OnMouseInput(input);
		}

		public void OnTextInput(string text)
		{
			DrainTouchEvents();
			Inner.OnTextInput(text);
		}

		public void DrainTouchEvents()
		{
			EnsureReader();
			if (reader == null)
				return;

			string line;
			while ((line = reader.ReadLine()) != null)
			{
				offset = stream.Position;
				var touchEvent = EutherAlertTouchBridge.ParseJsonLine(line);
				Apply(touchEvent);
				WriteApplyLog(touchEvent);
			}
		}

		void EnsureReader()
		{
			try
			{
				if (!File.Exists(path))
					return;

				if (stream == null)
				{
					stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
					stream.Seek(offset, SeekOrigin.Begin);
					reader = new StreamReader(stream);
				}
				else if (stream.Length < offset)
				{
					reader.Dispose();
					stream.Dispose();
					offset = 0;
					stream = null;
					reader = null;
					EnsureReader();
				}
			}
			catch
			{
				reader?.Dispose();
				stream?.Dispose();
				reader = null;
				stream = null;
			}
		}

		void Apply(EutherAlertTouchEvent touchEvent)
		{
			if (touchEvent == null || touchEvent.Payload == null)
				return;

			switch (touchEvent.Kind)
			{
				case "tap":
					Click(MouseButton.Left, Position(touchEvent), 1);
					break;
				case "doubleTap":
					Click(MouseButton.Left, Position(touchEvent), 2);
					break;
				case "dragStart":
					MouseDown(MouseButton.Left, Position(touchEvent));
					break;
				case "dragMove":
					MouseMove(Position(touchEvent));
					break;
				case "dragEnd":
					MouseUp(MouseButton.Left, Position(touchEvent));
					break;
				case "cancel":
					Click(MouseButton.Right, lastPos, 1);
					break;
				case "key":
					ApplySemanticKey(touchEvent);
					break;
			}
		}

		void WriteApplyLog(EutherAlertTouchEvent touchEvent)
		{
			if (touchEvent == null || string.IsNullOrWhiteSpace(applyLogPath))
				return;

			try
			{
				var dir = Path.GetDirectoryName(applyLogPath);
				if (!string.IsNullOrEmpty(dir))
					Directory.CreateDirectory(dir);

				File.AppendAllText(applyLogPath, JsonSerializer.Serialize(new
				{
					touchEvent.Id,
					touchEvent.Kind,
					touchEvent.Instance,
					touchEvent.Player,
					applied_unix_ms = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
				}) + Environment.NewLine);
			}
			catch
			{
			}
		}

		void ApplySemanticKey(EutherAlertTouchEvent touchEvent)
		{
			var key = Text(touchEvent, "key");
			switch (key)
			{
				case "attackMove":
					Key(Keycode.A);
					break;
				case "hold":
					Key(Keycode.S);
					break;
				case "focus":
					Key(Keycode.SPACE);
					break;
				case "selectBase":
					Key(Keycode.H);
					break;
			}
		}

		int2 Position(EutherAlertTouchEvent touchEvent)
		{
			var resolution = Game.Renderer.Resolution;
			var x = Number(touchEvent, "x", Number(touchEvent, "normalizedX", 0) * resolution.Width);
			var y = Number(touchEvent, "y", Number(touchEvent, "normalizedY", 0) * resolution.Height);
			x = Math.Clamp(x, 0, resolution.Width - 1);
			y = Math.Clamp(y, 0, resolution.Height - 1);
			return new int2((int)Math.Round(x), (int)Math.Round(y));
		}

		double Number(EutherAlertTouchEvent touchEvent, string key, double fallback)
		{
			if (!touchEvent.Payload.TryGetValue(key, out var value))
				return fallback;

			if (value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number))
				return number;

			if (value.ValueKind == JsonValueKind.String &&
				double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number))
				return number;

			return fallback;
		}

		string Text(EutherAlertTouchEvent touchEvent, string key)
		{
			if (!touchEvent.Payload.TryGetValue(key, out var value) || value.ValueKind != JsonValueKind.String)
				return null;

			return value.GetString();
		}

		void Click(MouseButton button, int2 pos, int multiTapCount)
		{
			MouseMove(pos);
			MouseDown(button, pos, multiTapCount);
			MouseUp(button, pos, multiTapCount);
		}

		void MouseMove(int2 pos)
		{
			var delta = pos - lastPos;
			lastPos = pos;
			Inner.OnMouseInput(new MouseInput(MouseInputEvent.Move, MouseButton.None, pos, delta, Modifiers.None, 0));
		}

		void MouseDown(MouseButton button, int2 pos, int multiTapCount = 0)
		{
			MouseMove(pos);
			if (button == MouseButton.Left)
				leftDown = true;
			Inner.OnMouseInput(new MouseInput(MouseInputEvent.Down, button, pos, int2.Zero, Modifiers.None, multiTapCount));
		}

		void MouseUp(MouseButton button, int2 pos, int multiTapCount = 0)
		{
			MouseMove(pos);
			if (button == MouseButton.Left)
				leftDown = false;
			Inner.OnMouseInput(new MouseInput(MouseInputEvent.Up, button, pos, int2.Zero, Modifiers.None, multiTapCount));
		}

		void Key(Keycode key)
		{
			Inner.OnKeyInput(new KeyInput { Event = KeyInputEvent.Down, Key = key });
			Inner.OnKeyInput(new KeyInput { Event = KeyInputEvent.Up, Key = key });
		}

		public void Dispose()
		{
			if (leftDown)
				MouseUp(MouseButton.Left, lastPos);

			reader?.Dispose();
			stream?.Dispose();
		}
	}
}
