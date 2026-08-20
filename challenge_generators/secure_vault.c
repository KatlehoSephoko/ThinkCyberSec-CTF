#include <stdio.h>
#include <string.h>

int main() {
    char flag[] = "tcs{visible_in_plaintext}";
    char input[100];
    printf("Password: ");
    scanf("%99s", input);
    if (strcmp(input, "admin123") == 0) printf("Flag: %s\n", flag);
    return 0;
}
